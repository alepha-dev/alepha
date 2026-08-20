import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { MilestoneController } from "../src/api/controllers/MilestoneController.ts";
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
  adminUserController: AdminUserController;
  projectController: ProjectController;
  milestoneController: MilestoneController;
  questController: QuestController;
  dt: DateTimeProvider;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    milestoneController: alepha.inject(MilestoneController),
    questController: alepha.inject(QuestController),
    dt: alepha.inject(DateTimeProvider),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

type TestUser = { id: string; roles: string[] };

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Test Project" } },
    { user },
  );
  return { id: created.data.id };
};

/**
 * Create a quest, accept it and complete it — the only way a quest lands in
 * a milestone's window.
 */
const completeQuest = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  quest: {
    title: string;
    area: string;
    priority: "optional" | "low" | "medium" | "high";
  },
): Promise<{ id: number; shortId: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        projectId,
        title: quest.title,
        area: quest.area,
        priority: quest.priority,
      },
    },
    { user },
  );
  await ctx.questController.acceptQuest.fetch(
    { params: { id: created.data.id } },
    { user },
  );
  await ctx.questController.completeQuest.fetch(
    { params: { id: created.data.id }, body: {} },
    { user },
  );
  return { id: created.data.id, shortId: created.data.shortId };
};

describe("MilestoneController.getMilestoneChangelog", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("returns structured areas alongside the markdown", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "minute"]);
    const a = await completeQuest(ctx, user, project.id, {
      title: "Lateral joins on Postgres",
      area: "orm",
      priority: "high",
    });
    const b = await completeQuest(ctx, user, project.id, {
      title: "Typed repository count",
      area: "orm",
      priority: "medium",
    });
    const c = await completeQuest(ctx, user, project.id, {
      title: "Rate limiter for public actions",
      area: "server",
      priority: "low",
    });

    const result = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    expect(result.data.areas.map((z) => z.name)).toEqual(["orm", "server"]);

    const orm = result.data.areas[0];
    expect(orm.questCount).toBe(2);
    expect(orm.quests).toEqual([
      {
        shortId: a.shortId,
        title: "Lateral joins on Postgres",
        priority: "high",
      },
      {
        shortId: b.shortId,
        title: "Typed repository count",
        priority: "medium",
      },
    ]);

    const server = result.data.areas[1];
    expect(server.quests).toEqual([
      {
        shortId: c.shortId,
        title: "Rate limiter for public actions",
        priority: "low",
      },
    ]);
  });

  it("agrees with the markdown on grouping and totals", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "minute"]);
    await completeQuest(ctx, user, project.id, {
      title: "Streaming multipart uploads",
      area: "server",
      priority: "high",
    });
    await completeQuest(ctx, user, project.id, {
      title: "Router transition progress bar",
      area: "react",
      priority: "low",
    });

    const result = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    // Every area heading in the markdown has a matching structured area,
    // and each area's title list matches line for line.
    for (const area of result.data.areas) {
      expect(result.data.markdown).toContain(`## ${area.name}`);
      for (const quest of area.quests) {
        expect(result.data.markdown).toContain(`- ${quest.title}`);
      }
    }

    const totalFromAreas = result.data.areas.reduce(
      (sum, area) => sum + area.questCount,
      0,
    );
    expect(totalFromAreas).toBe(result.data.stats.questCount);
    expect(result.data.stats.areaCount).toBe(result.data.areas.length);
  });

  it("returns the frozen markdown snapshot for a closed milestone", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "minute"]);
    await completeQuest(ctx, user, project.id, {
      title: "Sequence counter per project",
      area: "orm",
      priority: "high",
    });

    const closed = await ctx.milestoneController.closeMilestone.fetch(
      { params: { id: started.data.id }, body: {} },
      { user },
    );
    expect(closed.data.changelog).toBeDefined();

    const result = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    expect(result.data.markdown).toBe(closed.data.changelog);
    // Areas are recomputed rather than frozen — they still describe the
    // same window, so the closed milestone is not returned bare.
    expect(result.data.areas).toHaveLength(1);
    expect(result.data.areas[0].quests[0].title).toBe(
      "Sequence counter per project",
    );
  });

  it("returns no areas when nothing was completed in the window", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    const result = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    expect(result.data.areas).toEqual([]);
    expect(result.data.stats.questCount).toBe(0);
    expect(result.data.stats.areaCount).toBe(0);
  });

  it("excludes quests completed before the milestone opened", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await completeQuest(ctx, user, project.id, {
      title: "Landed before the window",
      area: "orm",
      priority: "high",
    });

    await ctx.dt.travel([1, "hour"]);
    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "minute"]);
    await completeQuest(ctx, user, project.id, {
      title: "Landed inside the window",
      area: "orm",
      priority: "high",
    });

    const result = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    const titles = result.data.areas.flatMap((area) =>
      area.quests.map((quest) => quest.title),
    );
    expect(titles).toEqual(["Landed inside the window"]);
  });
});
