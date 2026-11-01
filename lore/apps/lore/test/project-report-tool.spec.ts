import { ProjectController } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * `project_report` (#Q3015): every section registered by its own module,
 * answering through the action's gate.
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
  bootLore(alepha, ["api", "mcp"]);

  const tools = alepha.inject(ProjectTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const stranger = await users.createUser({ username: "stranger" });
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });
  const project = await asUser(owner.id, () =>
    projectApi.createProject({
      body: {
        title: "Reported",
        capabilities: [{ key: "work" }, { key: "knowledge" }, { key: "apps" }],
      },
    }),
  );
  const report = (section: string, userId = owner.id) =>
    asUser(userId, () =>
      tools.project_report.execute({ project: project.id, section, days: 7 }),
    );
  return { alepha, report, stranger };
};

describe("project_report", () => {
  it.each([
    ["summary", "lines"],
    ["flow", "throughput"],
    ["backlog", "open"],
    ["planning", "epics"],
    ["support", "intake"],
    ["knowledge", "activity"],
    ["delivery", "reliability"],
    ["team", "members"],
  ])("answers %s", async (section, key) => {
    const ctx = await setup();

    const result = await ctx.report(section);

    expect(result.section).toBe(section);
    expect(result.report).toHaveProperty(key);
    await ctx.alepha.stop();
  });

  it("names the sections when asked for one that does not exist", async () => {
    const ctx = await setup();

    await expect(ctx.report("nope")).rejects.toThrow("delivery");
    await ctx.alepha.stop();
  });

  it("refuses somebody outside the project", async () => {
    const ctx = await setup();

    await expect(ctx.report("summary", ctx.stranger.id)).rejects.toThrow();
    await ctx.alepha.stop();
  });
});
