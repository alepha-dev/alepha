import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectReportsController } from "../src/api/controllers/ProjectReportsController.ts";
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
  questController: QuestController;
  reportsController: ProjectReportsController;
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
    questController: alepha.inject(QuestController),
    reportsController: alepha.inject(ProjectReportsController),
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
    { body: { title: "Test Project" } },
    { user },
  );
  return { id: response.data.id, title: response.data.title };
}

async function createTestQuest(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  projectId: number,
  overrides: Partial<{
    title: string;
    zone: string;
    priority: "optional" | "low" | "medium" | "high";
    difficulty: number;
  }> = {},
) {
  const response = await ctx.questController.createQuest.fetch(
    {
      body: {
        title: overrides.title ?? "Test Quest",
        description: "<p>Test description</p>",
        zone: overrides.zone ?? "core",
        priority: overrides.priority ?? "medium",
        difficulty: overrides.difficulty ?? 3,
        projectId,
        objectives: [],
      },
    },
    { user },
  );
  return response.data;
}

describe("ProjectReportsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("getReportsOverview", () => {
    /**
     * Builds a project with quests in mixed lifecycle states: one
     * completed (accepted + completed), one accepted-only, one brand-new.
     * Reports is unlocked by `createTestProject`.
     */
    const setupReportsProject = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      // Completed quest — accepted then completed.
      const done = await createTestQuest(ctx, owner, project.id, {
        title: "Completed Quest",
        zone: "core",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: done.id } },
        { user: owner },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: done.id }, body: {} },
        { user: owner },
      );

      // Accepted-only quest.
      const accepted = await createTestQuest(ctx, owner, project.id, {
        title: "Accepted Quest",
        zone: "core",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: accepted.id } },
        { user: owner },
      );

      // Brand-new quest.
      await createTestQuest(ctx, owner, project.id, {
        title: "New Quest",
        zone: "frontend",
      });

      return {
        projectId: project.id,
        owner,
        controller: ctx.reportsController,
      };
    };

    it("getReportsOverview returns KPIs, burn-up and attention counts", async ({
      expect,
    }) => {
      const c = await setupReportsProject();
      const res = await c.controller.getReportsOverview.fetch(
        { params: { id: c.projectId } },
        { user: c.owner },
      );
      expect(res.data.kpis.totalQuests).toBeGreaterThanOrEqual(3);
      expect(res.data.kpis.openQuests).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.data.burnup)).toBe(true);
      expect(res.data.attention).toHaveProperty("staleQuests");
    });

    it("getReportsQuests returns the funnel, breakdowns and aging list", async ({
      expect,
    }) => {
      const ctx = await setupReportsProject();
      const res = await ctx.controller.getReportsQuests.fetch(
        { params: { id: ctx.projectId } },
        { user: ctx.owner },
      );
      expect(
        res.data.funnel.new +
          res.data.funnel.accepted +
          res.data.funnel.completed,
      ).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(res.data.byZone)).toBe(true);
      expect(Array.isArray(res.data.aging)).toBe(true);
    });

    it("getReportsMembers returns the leaderboard and contribution series", async ({
      expect,
    }) => {
      const ctx = await setupReportsProject();
      const res = await ctx.controller.getReportsMembers.fetch(
        { params: { id: ctx.projectId } },
        { user: ctx.owner },
      );
      expect(Array.isArray(res.data.leaderboard)).toBe(true);
      expect(Array.isArray(res.data.contributors)).toBe(true);
      expect(Array.isArray(res.data.contribution)).toBe(true);
    });
  });
});
