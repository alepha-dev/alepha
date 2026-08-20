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

/**
 * Project titles derive a globally unique URL slug, so two projects cannot
 * share one — the cross-project isolation test creates a second project.
 * A counter rather than a timestamp keeps the titles deterministic.
 */
let projectSeq = 0;

const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
): Promise<{ id: number }> => {
  projectSeq += 1;
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: `Test Project ${projectSeq}` } },
    { user },
  );
  return { id: created.data.id };
};

const completeQuest = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  title: string,
): Promise<void> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        area: "orm",
        priority: "medium",
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
};

describe("MilestoneController.getMilestoneBacklog", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("counts quests completed since the last milestone closed", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: { title: "July release" } },
      { user },
    );
    await ctx.dt.travel([1, "minute"]);
    await completeQuest(ctx, user, project.id, "Recorded inside the window");

    const closed = await ctx.milestoneController.closeMilestone.fetch(
      { params: { id: started.data.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "hour"]);
    await completeQuest(ctx, user, project.id, "Orphan one");
    await completeQuest(ctx, user, project.id, "Orphan two");

    const result = await ctx.milestoneController.getMilestoneBacklog.fetch(
      { params: { projectId: project.id } },
      { user },
    );

    expect(result.data.count).toBe(2);
    expect(result.data.since).toBe(closed.data.closedAt);
    expect(result.data.lastNumber).toBe(started.data.number);
    expect(result.data.lastTitle).toBe("July release");
  });

  it("reports zero while a milestone is recording", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const first = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );
    await ctx.milestoneController.closeMilestone.fetch(
      { params: { id: first.data.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "hour"]);
    await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "minute"]);
    await completeQuest(ctx, user, project.id, "Being recorded right now");

    const result = await ctx.milestoneController.getMilestoneBacklog.fetch(
      { params: { projectId: project.id } },
      { user },
    );

    expect(result.data.count).toBe(0);
  });

  it("counts the whole project when no milestone has ever closed", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await completeQuest(ctx, user, project.id, "One");
    await completeQuest(ctx, user, project.id, "Two");
    await completeQuest(ctx, user, project.id, "Three");

    const result = await ctx.milestoneController.getMilestoneBacklog.fetch(
      { params: { projectId: project.id } },
      { user },
    );

    expect(result.data.count).toBe(3);
    expect(result.data.since).toBeUndefined();
    expect(result.data.lastNumber).toBeUndefined();
  });

  it("ignores quests belonging to another project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user);
    const other = await createTestProject(ctx, user);

    await completeQuest(ctx, user, mine.id, "Mine");
    await completeQuest(ctx, user, other.id, "Theirs");
    await completeQuest(ctx, user, other.id, "Theirs too");

    const result = await ctx.milestoneController.getMilestoneBacklog.fetch(
      { params: { projectId: mine.id } },
      { user },
    );

    expect(result.data.count).toBe(1);
  });
});
