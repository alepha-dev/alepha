import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectStatsController } from "../src/api/controllers/ProjectStatsController.ts";
import { TaskController } from "../src/api/controllers/TaskController.ts";
import { RoadmapApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  taskController: TaskController;
  statsController: ProjectStatsController;
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
  alepha.with(RoadmapApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    taskController: alepha.inject(TaskController),
    statsController: alepha.inject(ProjectStatsController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

async function createTestUser(
  ctx: TestContext,
  roles: string[] = ["user"],
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

async function createTestProject(
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<{ id: number; title: string }> {
  const response = await ctx.projectController.createProject.fetch(
    { body: { title: "Test Campaign" } },
    { user },
  );
  return { id: response.data.id, title: response.data.title };
}

async function createTestTask(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  projectId: number,
  overrides: Partial<{
    title: string;
    package: string;
    priority: "optional" | "low" | "medium" | "high";
    complexity: number;
  }> = {},
) {
  const response = await ctx.taskController.createTask.fetch(
    {
      body: {
        title: overrides.title ?? "Test Quest",
        description: "<p>Test description</p>",
        package: overrides.package ?? "core",
        priority: overrides.priority ?? "medium",
        complexity: overrides.complexity ?? 3,
        projectId,
        objectives: [],
      },
    },
    { user },
  );
  return response.data;
}

describe("ProjectStatsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("getProjectStats", () => {
    it("should return stats for a project with no tasks", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      expect(response.data.overview.totalTasks).toBe(0);
      expect(response.data.overview.completedTasks).toBe(0);
      expect(response.data.overview.activePlayers).toBeGreaterThanOrEqual(0);
      expect(response.data.overview.totalXP).toBe(0);
      expect(response.data.tasksByPriority).toStrictEqual([]);
      expect(response.data.tasksByComplexity).toStrictEqual([]);
      expect(response.data.topZones).toStrictEqual([]);
      expect(response.data.completionRate.overall).toBe(0);
    });

    it("should count tasks by priority", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      await createTestTask(ctx, user, project.id, { priority: "high" });
      await createTestTask(ctx, user, project.id, { priority: "high" });
      await createTestTask(ctx, user, project.id, { priority: "low" });

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      const highPriority = response.data.tasksByPriority.find(
        (p) => p.priority === "high",
      );
      const lowPriority = response.data.tasksByPriority.find(
        (p) => p.priority === "low",
      );

      expect(highPriority?.count).toBe(2);
      expect(lowPriority?.count).toBe(1);
    });

    it("should count tasks by complexity", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      await createTestTask(ctx, user, project.id, { complexity: 1 });
      await createTestTask(ctx, user, project.id, { complexity: 1 });
      await createTestTask(ctx, user, project.id, { complexity: 5 });

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      const complexity1 = response.data.tasksByComplexity.find(
        (c) => c.complexity === 1,
      );
      const complexity5 = response.data.tasksByComplexity.find(
        (c) => c.complexity === 5,
      );

      expect(complexity1?.count).toBe(2);
      expect(complexity5?.count).toBe(1);
    });

    it("should return top zones", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      await createTestTask(ctx, user, project.id, { package: "backend" });
      await createTestTask(ctx, user, project.id, { package: "backend" });
      await createTestTask(ctx, user, project.id, { package: "frontend" });

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      expect(response.data.topZones).toHaveLength(2);
      expect(response.data.topZones[0].zone).toBe("backend");
      expect(response.data.topZones[0].totalTasks).toBe(2);
      expect(response.data.topZones[1].zone).toBe("frontend");
      expect(response.data.topZones[1].totalTasks).toBe(1);
    });

    it("should return overview with correct totals", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      await createTestTask(ctx, user, project.id, { complexity: 2 });
      await createTestTask(ctx, user, project.id, { complexity: 4 });

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      expect(response.data.overview.totalTasks).toBe(2);
      expect(response.data.overview.averageTaskComplexity).toBe(3);
    });

    it("should return activity timeline", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      // Should return 365 days of timeline data
      expect(response.data.activityTimeline).toHaveLength(365);
    });

    it("should track completed tasks in timeline and completion rates", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);

      const task = await createTestTask(ctx, user, project.id);

      // Accept then complete the task through the controller
      await ctx.taskController.acceptTask.fetch(
        { params: { id: task.id } },
        { user },
      );
      await ctx.taskController.completeTask.fetch(
        { params: { id: task.id } },
        { user },
      );

      const response = await ctx.statsController.getProjectStats.fetch(
        { params: { id: project.id } },
        { user },
      );

      expect(response.data.overview.completedTasks).toBe(1);
      expect(response.data.completionRate.weekly).toBeGreaterThanOrEqual(1);
      expect(response.data.completionRate.monthly).toBeGreaterThanOrEqual(1);
      expect(response.data.completionRate.overall).toBe(100);
    });
  });
});
