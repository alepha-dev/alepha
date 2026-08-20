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
 * The write-and-read-back loop that is the point of quest comments over MCP:
 * an agent that can leave a note but cannot see the reply has half of it.
 *
 * Same identity-injection shim as `quest-tools-epic.spec.ts` — `execute()`
 * reads the caller off the request context, not an argument.
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

  // biome-ignore lint/suspicious/noExplicitAny: mirrors quest-tools-epic.spec.ts's own tool-execute helper
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

  return { questTools, project, quest, call, OWNER };
};

describe("Lore MCP — quest comments", () => {
  it("quest_comment_add posts as the caller and returns the comment", async () => {
    const { questTools, quest, call } = await setup();

    const comment = await call(questTools.quest_comment_add, {
      id: quest.id,
      body: "Blocked on the D1 cascade; see #12.",
    });

    expect(comment.id).toBeGreaterThan(0);
    expect(comment.body).toBe("Blocked on the D1 cascade; see #12.");
    expect(comment.createdAt).toBeTruthy();
    expect(comment.editedAt).toBeUndefined();
  });

  it("addresses a quest by shortId too, with the project", async () => {
    const { questTools, project, quest, call } = await setup();

    const comment = await call(questTools.quest_comment_add, {
      shortId: quest.shortId,
      project: project.id,
      body: "By shortId.",
    });

    expect(comment.body).toBe("By shortId.");
    // Same quest, reached the other way.
    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.discussion.map((c: any) => c.body)).toEqual(["By shortId."]);
  });

  it("quest_get reads the discussion back, oldest first, with authors", async () => {
    const { questTools, quest, call } = await setup();

    await call(questTools.quest_comment_add, { id: quest.id, body: "First" });
    await call(questTools.quest_comment_add, { id: quest.id, body: "Second" });

    const res = await call(questTools.quest_get, { id: quest.id });

    expect(res.discussion.map((c: any) => c.body)).toEqual(["First", "Second"]);
    // A uuid answers nothing; the name is what an agent can act on.
    expect(res.discussion[0].author).toBe("owner");
    expect(res.discussionTruncated).toBe(false);
  });

  it("reports an empty discussion without pretending it is truncated", async () => {
    const { questTools, quest, call } = await setup();

    const res = await call(questTools.quest_get, { id: quest.id });

    expect(res.discussion).toEqual([]);
    expect(res.discussionTruncated).toBe(false);
  });

  it("caps a long thread at the most recent slice and says so", async () => {
    const { questTools, quest, call } = await setup();

    for (let i = 1; i <= 52; i++) {
      await call(questTools.quest_comment_add, {
        id: quest.id,
        body: `comment ${i}`,
      });
    }

    const res = await call(questTools.quest_get, { id: quest.id });

    // The tail, not the head: the recent end of a conversation is the part
    // that still matters.
    expect(res.discussion).toHaveLength(50);
    expect(res.discussion[0].body).toBe("comment 3");
    expect(res.discussion.at(-1).body).toBe("comment 52");
    expect(res.discussionTruncated).toBe(true);
  });
});
