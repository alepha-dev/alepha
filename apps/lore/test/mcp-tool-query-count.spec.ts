import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer, NotFoundError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { FeedbackTools } from "../src/mcp/tools/FeedbackTools.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

/**
 * The number this file exists for.
 *
 * Every project-scoped MCP tool starts by turning `project` into a project
 * id, and that resolution used to call `getMyProjects()` - a relational read
 * of the caller plus every project they belong to, mapped through
 * `projectMapper.toResource` - only to hand back the numeric id it was given.
 * On `feedback_list` that was three of the call's five reads, spent before
 * the tool did any of its own work.
 *
 * An MCP call is one operation per HTTP request, so unlike `POST /api/_batch`
 * there is no sibling to amortize that cost against: it is paid in full on
 * every tool call. Nothing else in the pipeline measures it, which is how it
 * survived this long.
 */

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);
  alepha.with(ReadCounter);

  const counter = alepha.inject(ReadCounter);
  const feedbackTools = alepha.inject(FeedbackTools) as any;
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (
    tool: any,
    params: Record<string, unknown>,
    userId = owner.id,
  ) => asUser(userId, () => tool.execute(params));

  // Created through the controller: ownership lives in a membership record,
  // so a bare row is a project nobody owns.
  const project = await asUser(owner.id, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  // Several more, so a resolution that reads the whole list is paying for
  // rows it will discard.
  for (let i = 0; i < 4; i++) {
    await asUser(owner.id, () =>
      projectApi.createProject({ body: { title: `Other ${i}` } } as any),
    );
  }

  const totalReads = () =>
    [...counter.byTable.values()].reduce((a, b) => a + b, 0);

  return {
    alepha,
    counter,
    feedbackTools,
    projectApi,
    users,
    call,
    project,
    totalReads,
    asUser,
  };
};

describe("MCP tool query count", () => {
  it("resolves a numeric project without reading the caller's whole project list", async () => {
    const ctx = await setup();

    ctx.counter.reset();
    await ctx.call(ctx.feedbackTools.feedback_list, {
      project: ctx.project.id,
    });

    // Four, and each one is now doing something: `projects` authorizes the
    // call, `users` names the reporters, `feedback` is the page, `quests` are
    // the linked quests. It was six - the two extra were `getMyProjects`
    // reading the caller and their whole project list to hand back the id it
    // was given.
    //
    // The `projects` read is served from the ORM's keyed cache for 30s
    // (`ProjectSecurityService.PROJECT_CACHE_TTL_MS`), so a second tool call
    // inside that window pays three. This asserts the cold number, which is
    // what a first call after a deploy actually costs.
    expect(ctx.totalReads()).toBeLessThanOrEqual(4);

    await ctx.alepha.stop();
  });

  it("still refuses a project the caller does not belong to", async () => {
    const ctx = await setup();
    const stranger = await ctx.users.createUser({ username: "stranger" });

    // The resolution is the authorization: it is the only thing standing
    // between a non-member and the project's feedback, because a tool calls
    // the controller method directly and never passes through `$ownsProject`.
    //
    // `NotFoundError` and not `ForbiddenError`, asserted rather than left to
    // a bare `toThrow()`: `assertMember` refuses with `ForbiddenError`, which
    // confirms the project exists, and this surface deliberately does not.
    // Making the read cheaper must not widen what a non-member can learn.
    await expect(
      ctx.call(
        ctx.feedbackTools.feedback_list,
        { project: ctx.project.id },
        stranger.id,
      ),
    ).rejects.toThrowError(NotFoundError);

    await ctx.alepha.stop();
  });
});
