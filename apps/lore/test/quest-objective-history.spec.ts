import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

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
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
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

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * Walk a quest through create → accept so its objectives can be toggled.
 * `completeObjective` requires `acceptedAt !== null` and `completedAt === null`.
 */
const seedAcceptedQuest = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  objectives: Array<{ title: string; completed: boolean }>,
): Promise<{ id: number; projectId: number }> => {
  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Objective Probe" } },
    { user },
  );
  const created = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId: project.data.id,
        title: "History Spam Probe",
        description: "<p>x</p>",
        area: "test",
        priority: "low",
        objectives,
      },
    },
    { user },
  );
  await ctx.quests.acceptQuest.fetch(
    { params: { id: created.data.id } },
    { user },
  );
  return { id: created.data.id, projectId: project.data.id };
};

describe("QuestController completeObjective", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("assigns stable ids to objectives at create time", async ({ expect }) => {
    const user = await createUser(ctx);
    const { id: questId } = await seedAcceptedQuest(ctx, user, [
      { title: "Alpha", completed: false },
      { title: "Beta", completed: false },
    ]);

    const repo = ctx.alepha.inject(QuestController).quests;
    const row = await repo.findOne({ where: { id: { eq: questId } } });
    expect(row?.objectives.map((o) => o.id)).toEqual([0, 1]);
  });

  it("ticking an objective appends one history entry tagged with its id", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const { id: questId } = await seedAcceptedQuest(ctx, user, [
      { title: "Alpha", completed: false },
      { title: "Beta", completed: false },
    ]);

    const after = await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 1 } },
      { user },
    );
    // acceptQuest already wrote one history row (assignment); the tick
    // adds the second.
    const completedEntries = after.data.history.filter(
      (h) => h.action === "objective_completed",
    );
    expect(completedEntries).toHaveLength(1);
    expect(completedEntries[0].objectiveId).toBe(1);
    expect(after.data.objectives[1]?.completed).toBe(true);
    expect(after.data.objectives[0]?.completed).toBe(false);
  });

  it("unticking the same objective REMOVES the matching history entry — no spam", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const { id: questId } = await seedAcceptedQuest(ctx, user, [
      { title: "Alpha", completed: false },
    ]);

    // tick → untick → tick → untick
    await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 0 } },
      { user },
    );
    await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 0 } },
      { user },
    );
    await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 0 } },
      { user },
    );
    const after = await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 0 } },
      { user },
    );

    // After two ticks and two unticks, the objective is back to uncompleted
    // and the history has no objective_completed rows (spam-free).
    expect(after.data.objectives[0]?.completed).toBe(false);
    expect(
      after.data.history.filter((h) => h.action === "objective_completed"),
    ).toEqual([]);
  });

  it("backfills legacy objectives missing ids on first write", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const { id: questId } = await seedAcceptedQuest(ctx, user, [
      { title: "Legacy A", completed: false },
      { title: "Legacy B", completed: false },
    ]);

    // Simulate a row written before the id column existed: strip ids.
    const repo = ctx.quests.quests;
    await repo.updateById(questId, {
      objectives: [
        { title: "Legacy A", completed: false },
        { title: "Legacy B", completed: false },
      ] as never,
    });

    const after = await ctx.quests.completeObjective.fetch(
      { params: { id: questId }, body: { objectiveId: 1 } },
      { user },
    );

    // Both objectives now have ids (0 and 1, matching their original indices).
    expect(after.data.objectives.map((o) => o.id)).toEqual([0, 1]);
    expect(after.data.objectives[1]?.completed).toBe(true);
    expect(
      after.data.history.filter((h) => h.action === "objective_completed"),
    ).toHaveLength(1);

    // Sanity: repo returns the same ids on subsequent reads (persistent).
    const reread = await repo.findOne({ where: { id: { eq: questId } } });
    expect(reread?.objectives.map((o) => o.id)).toEqual([0, 1]);
  });
});
