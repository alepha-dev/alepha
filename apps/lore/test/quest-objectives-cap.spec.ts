import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  exceedsObjectiveCap,
  MAX_QUEST_OBJECTIVES,
} from "../src/api/schemas/questObjectivesLimit.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  await alepha.start();
  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
  };
};

const objectives = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    title: `Objective ${i + 1}`,
    completed: false,
  }));

/**
 * The rule itself, which is the part worth pinning hardest.
 *
 * "May not GROW past the cap" is not the same as "may not BE over it", and
 * every awkward case below comes from quests that already exist above the
 * cap. A flat cap would strand them: the tree of things you can no longer do
 * to a fifteen-objective quest includes renaming it, because a rename sends
 * the whole array back.
 */
describe("exceedsObjectiveCap", () => {
  it("allows anything up to the cap", ({ expect }) => {
    expect(exceedsObjectiveCap(MAX_QUEST_OBJECTIVES, 0)).toBe(false);
    expect(exceedsObjectiveCap(MAX_QUEST_OBJECTIVES, 3)).toBe(false);
  });

  it("refuses growing past the cap", ({ expect }) => {
    expect(exceedsObjectiveCap(MAX_QUEST_OBJECTIVES + 1, 0)).toBe(true);
    expect(exceedsObjectiveCap(MAX_QUEST_OBJECTIVES + 1, 3)).toBe(true);
  });

  it("lets an already-over-cap quest be passed back unchanged", ({
    expect,
  }) => {
    // A rename sends every objective back. Refusing this is what would make
    // such a quest uneditable.
    expect(exceedsObjectiveCap(15, 15)).toBe(false);
  });

  it("lets an already-over-cap quest shrink, even while still over", ({
    expect,
  }) => {
    // Moving toward the cap must never be refused: it is the only way out.
    expect(exceedsObjectiveCap(12, 15)).toBe(false);
  });

  it("still refuses growth on an already-over-cap quest", ({ expect }) => {
    expect(exceedsObjectiveCap(16, 15)).toBe(true);
  });
});

describe("quest objectives cap, end to end", () => {
  let ctx: TestContext;
  let user: { id: string; roles: string[] };
  let projectId: number;

  beforeEach(async () => {
    ctx = await setup();
    const fake = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
    user = { id: created.data.id, roles: created.data.roles };
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Cap probe" } },
      { user },
    );
    projectId = project.data.id;
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const create = async (count: number) =>
    await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: `Quest with ${count}`,
          description: "",
          area: "ops",
          priority: "low",
          objectives: objectives(count),
        },
      },
      { user },
    );

  it("creates a quest at the cap", async () => {
    const res = await create(MAX_QUEST_OBJECTIVES);
    expect(res.data.objectives).toHaveLength(MAX_QUEST_OBJECTIVES);
  });

  it("refuses to create one past the cap", async () => {
    await expect(create(MAX_QUEST_OBJECTIVES + 1)).rejects.toThrow();
  });

  it("refuses to grow an ordinary quest past the cap", async () => {
    const quest = await create(3);
    // Asserted on the message, not just that something threw: this endpoint
    // has several other ways to refuse (concurrency, completed-quest freeze)
    // and a bare `toThrow` would pass on any of them.
    await expect(
      ctx.quests.updateQuestById.fetch(
        {
          params: { id: quest.data.id },
          body: { objectives: objectives(MAX_QUEST_OBJECTIVES + 1) },
        },
        { user },
      ),
    ).rejects.toThrow(/at most 10 objectives/);
  });

  /**
   * The trap the quest called out, and the reason the cap is not a `.max()`
   * on the update schema.
   *
   * The over-cap row is written through the repository rather than the API,
   * because the API is exactly what now refuses to make one. That is not
   * cheating: it reproduces the only way such a row can exist, which is
   * having been created before the cap did.
   */
  describe("a quest that predates the cap", () => {
    const OVER = 15;
    let questId: number;

    beforeEach(async () => {
      const quest = await create(3);
      questId = quest.data.id;
      // A deliberate reach past the API, and the only way to build this
      // fixture: the API is precisely what refuses to create such a row now.
      const repo = (ctx.quests as any).quests;
      await repo.updateById(questId, { objectives: objectives(OVER) });
    });

    it("can still be renamed, sending its objectives back unchanged", async () => {
      const res = await ctx.quests.updateQuestById.fetch(
        {
          params: { id: questId },
          body: { title: "Renamed", objectives: objectives(OVER) },
        },
        { user },
      );
      expect(res.data.title).toBe("Renamed");
      expect(res.data.objectives).toHaveLength(OVER);
    });

    it("can be edited without touching its objectives at all", async () => {
      const res = await ctx.quests.updateQuestById.fetch(
        { params: { id: questId }, body: { title: "Just the title" } },
        { user },
      );
      expect(res.data.title).toBe("Just the title");
    });

    it("can shrink while still over the cap", async () => {
      const res = await ctx.quests.updateQuestById.fetch(
        { params: { id: questId }, body: { objectives: objectives(12) } },
        { user },
      );
      expect(res.data.objectives).toHaveLength(12);
    });

    it("can be accepted and completed", async () => {
      await ctx.quests.acceptQuest.fetch({ params: { id: questId } }, { user });
      const res = await ctx.quests.completeQuest.fetch(
        {
          params: { id: questId },
          body: {
            waive: objectives(OVER).map((_, i) => ({
              objectiveId: i,
              reason: "not needed",
            })),
          },
        },
        { user },
      );
      expect(res.data.completedAt).toBeTruthy();
    });

    it("still cannot grow", async () => {
      await expect(
        ctx.quests.updateQuestById.fetch(
          {
            params: { id: questId },
            body: { objectives: objectives(OVER + 1) },
          },
          { user },
        ),
      ).rejects.toThrow(/at most 10 objectives/);
    });
  });
});
