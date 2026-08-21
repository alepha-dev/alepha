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
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * `quest_unassign`: `quest_shelve`'s description told the caller to abandon
 * an accepted quest first, and there was no tool that did it.
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
  const questApi = alepha.inject(QuestController);
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

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
    accept: true,
  });

  const resource = () =>
    asUser(OWNER, () => questApi.getQuestById({ params: { id: quest.id } }));

  /**
   * Turn on the reminder sweep for this quest, so unassigning has something
   * to clear. `questReminder` is a per-project toggle and off by default, so
   * flip it on the row first, the same way `quest-reminder.spec.ts` does.
   */
  const remind = async () => {
    const row = await projectApi.projects.getOne({
      where: { id: { eq: project.id } },
    });
    row.features = { ...row.features, questReminder: true };
    await projectApi.projects.save(row);

    return asUser(OWNER, () =>
      questApi.setQuestReminder({
        params: { id: quest.id },
        body: { interval: "daily" },
      }),
    );
  };

  return { questTools, project, quest, call, resource, remind };
};

describe("Lore MCP: quest_unassign", () => {
  it("sends an accepted quest back to the backlog and clears the reminder", async () => {
    const { questTools, quest, call, resource, remind } = await setup();

    const armed = await remind();
    expect(armed.reminderInterval).toBe("daily");
    expect(armed.reminderNextAt).toBeTruthy();

    const result = await call(questTools.quest_unassign, { id: quest.id });
    expect(result.status).toBe("new");
    expect(result.shortId).toBe(quest.shortId);

    const after = await resource();
    expect(after.acceptedAt).toBeUndefined();
    expect(after.acceptedBy).toBeUndefined();
    expect(after.reminderInterval).toBeUndefined();
    expect(after.reminderNextAt).toBeUndefined();
    expect(after.history.some((h) => h.action === "unassigned")).toBe(true);
    // Nothing written on the quest is lost: this is not a delete.
    expect(after.title).toBe("Wire the pipeline");
    expect(after.description).toBe("x");
  });

  it("unblocks quest_shelve, which only takes a quest in 'new'", async () => {
    const { questTools, quest, call } = await setup();

    await expect(
      call(questTools.quest_shelve, { id: quest.id }),
    ).rejects.toThrowError(/expected "new"/i);

    await call(questTools.quest_unassign, { id: quest.id });
    const shelved = await call(questTools.quest_shelve, { id: quest.id });
    expect(shelved.shelvedAt).toBeTruthy();
  });

  it("refuses a quest nobody has accepted", async () => {
    const { questTools, project, call } = await setup();

    const fresh = await call(questTools.quest_create, {
      project: project.id,
      title: "Untouched",
      description: "x",
      area: "core",
      priority: "medium",
    });

    await expect(
      call(questTools.quest_unassign, { id: fresh.id }),
    ).rejects.toThrowError(/expected "accepted"/i);
  });
});
