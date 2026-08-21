import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestCommentController } from "../src/api/controllers/QuestCommentController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * Over MCP the session user IS the owner's account, so an agent's comment is
 * indistinguishable from the owner's unless the row says who wrote it.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`.
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

  const questTools = alepha.inject(QuestTools);
  const commentApi = alepha.inject(QuestCommentController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
  });

  return { questTools, commentApi, project, quest, call, asUser, OWNER };
};

describe("Lore MCP: agent-authored comments", () => {
  it("stamps every comment written through quest_comment_add", async () => {
    const { questTools, quest, call } = await setup();

    const comment = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Ran the probe; p75 is 118ms.",
    });

    expect(comment.authorKind).toBe("agent");
    // Nothing names itself unless it passes `as`.
    expect(comment.client).toBeUndefined();
  });

  it("records the client name when the agent names itself", async () => {
    const { questTools, quest, call } = await setup();

    const comment = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Shipped as 448808eb4.",
      as: "claude-code",
    });

    expect(comment.authorKind).toBe("agent");
    expect(comment.client).toBe("claude-code");

    const res = await call(questTools.quest_get, { id: quest.id });
    expect(res.discussion[0].client).toBe("claude-code");
  });

  it("leaves a comment written through the web path unmarked", async () => {
    const { questTools, commentApi, quest, call, asUser, OWNER } =
      await setup();

    // The web client posts without `source`, which is the whole encoding of
    // "a human typed this".
    await asUser(OWNER, () =>
      commentApi.createQuestComment({
        params: { id: quest.id },
        body: { body: "Typed in the UI." },
      }),
    );
    await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Posted over MCP.",
    });

    const res = await call(questTools.quest_get, { id: quest.id });

    expect(res.discussion.map((c: any) => [c.body, c.authorKind])).toEqual([
      ["Typed in the UI.", "human"],
      ["Posted over MCP.", "agent"],
    ]);
    // `author` stays the account name on both: the account really did post
    // them, and it is still who to ask about either one.
    expect(res.discussion.map((c: any) => c.author)).toEqual([
      "owner",
      "owner",
    ]);
  });
});
