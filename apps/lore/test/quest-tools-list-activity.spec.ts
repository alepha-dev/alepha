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
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * The activity signal on `quest_list`: an agent scanning a project has to be
 * able to see that someone spoke on a quest since it last looked, without
 * one `quest_get` per row.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`:
 * `execute()` reads the caller off the request context, not an argument.
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

  // biome-ignore lint/suspicious/noExplicitAny: mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const forge = (title: string) =>
    call(questTools.quest_create, {
      project: project.id,
      title,
      description: "x",
      area: "core",
      priority: "medium",
    });

  return { questTools, project, call, forge, OWNER };
};

describe("Lore MCP: quest_list detail", () => {
  it("omits bodies by default and inlines them on request", async () => {
    const { questTools, project, call } = await setup();
    await call(questTools.quest_create, {
      project: project.id,
      title: "Heavy quest",
      description: "A very long design note that nobody scanning a list wants.",
      area: "core",
      priority: "medium",
      objectives: [{ title: "Do the thing", completed: false }],
    });

    const summary = await call(questTools.quest_list, { project: project.id });
    expect(summary.quests[0].description).toBeUndefined();
    expect(summary.quests[0].objectives).toBeUndefined();
    // The counts survive, which is what a list scan actually needs.
    expect(summary.quests[0].objectivesProgress).toEqual({
      completed: 0,
      waived: 0,
      total: 1,
    });
    // Everything else is unchanged.
    expect(summary.quests[0].title).toBe("Heavy quest");
    expect(summary.quests[0].area).toBe("core");

    const full = await call(questTools.quest_list, {
      project: project.id,
      detail: "full",
    });
    expect(full.quests[0].description).toContain("A very long design note");
    expect(full.quests[0].objectives).toHaveLength(1);
  });
});

describe("Lore MCP: quest_list activity signal", () => {
  it("reports zero comments and no lastCommentAt on a fresh quest", async () => {
    const { questTools, project, call, forge } = await setup();
    await forge("Silent quest");

    const res = await call(questTools.quest_list, { project: project.id });

    expect(res.quests).toHaveLength(1);
    expect(res.quests[0].commentCount).toBe(0);
    // Absent, not zero-valued: nobody has spoken, so there is no stamp to
    // compare a previous listing against.
    expect(res.quests[0].lastCommentAt).toBeUndefined();
    expect(res.quests[0].updatedAt).toBeTruthy();
  });

  it("carries the count and the newest stamp once someone speaks", async () => {
    const { questTools, project, call, forge } = await setup();
    const quest = await forge("Noisy quest");

    const first = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "First",
    });

    const one = await call(questTools.quest_list, { project: project.id });
    expect(one.quests[0].commentCount).toBe(1);
    expect(one.quests[0].lastCommentAt).toBe(first.createdAt);

    const second = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Second",
    });
    const third = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Third",
    });

    const many = await call(questTools.quest_list, { project: project.id });
    expect(many.quests[0].commentCount).toBe(3);
    // The NEWEST stamp, which is the only one an agent can diff against the
    // time of its own last listing.
    expect(Date.parse(many.quests[0].lastCommentAt)).toBeGreaterThanOrEqual(
      Date.parse(second.createdAt),
    );
    expect(many.quests[0].lastCommentAt).toBe(third.createdAt);
  });

  it("keeps each quest's numbers to itself across a page", async () => {
    const { questTools, project, call, forge } = await setup();
    const quiet = await forge("Quiet");
    const loud = await forge("Loud");

    await call(questTools.quest_comment_add, { id: loud.id, body: "a" });
    await call(questTools.quest_comment_add, { id: loud.id, body: "b" });

    const res = await call(questTools.quest_list, { project: project.id });
    const byId = new Map<number, any>(res.quests.map((q: any) => [q.id, q]));

    expect(byId.get(loud.id).commentCount).toBe(2);
    expect(byId.get(quiet.id).commentCount).toBe(0);
    expect(byId.get(quiet.id).lastCommentAt).toBeUndefined();
  });
});
