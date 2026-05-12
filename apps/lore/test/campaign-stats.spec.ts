import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { CampaignStatsController } from "../src/api/controllers/CampaignStatsController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  questController: QuestController;
  statsController: CampaignStatsController;
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
    campaignController: alepha.inject(CampaignController),
    questController: alepha.inject(QuestController),
    statsController: alepha.inject(CampaignStatsController),
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

async function createTestCampaign(
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<{ id: number; title: string }> {
  const response = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Test Campaign" } },
    { user },
  );
  return { id: response.data.id, title: response.data.title };
}

async function createTestQuest(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  campaignId: number,
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
        campaignId,
        objectives: [],
      },
    },
    { user },
  );
  return response.data;
}

describe("CampaignStatsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("getCampaignStats", () => {
    it("should return stats for a campaign with no quests", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      expect(response.data.overview.totalQuests).toBe(0);
      expect(response.data.overview.completedQuests).toBe(0);
      expect(response.data.overview.activeAdventurers).toBeGreaterThanOrEqual(
        0,
      );
      expect(response.data.overview.totalXP).toBe(0);
      expect(response.data.questsByPriority).toStrictEqual([]);
      expect(response.data.questsByDifficulty).toStrictEqual([]);
      expect(response.data.topZones).toStrictEqual([]);
      expect(response.data.completionRate.overall).toBe(0);
    });

    it("should count quests by priority", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      await createTestQuest(ctx, user, campaign.id, { priority: "high" });
      await createTestQuest(ctx, user, campaign.id, { priority: "high" });
      await createTestQuest(ctx, user, campaign.id, { priority: "low" });

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      const highPriority = response.data.questsByPriority.find(
        (p) => p.priority === "high",
      );
      const lowPriority = response.data.questsByPriority.find(
        (p) => p.priority === "low",
      );

      expect(highPriority?.count).toBe(2);
      expect(lowPriority?.count).toBe(1);
    });

    it("should count quests by difficulty", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      await createTestQuest(ctx, user, campaign.id, { difficulty: 1 });
      await createTestQuest(ctx, user, campaign.id, { difficulty: 1 });
      await createTestQuest(ctx, user, campaign.id, { difficulty: 5 });

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      const difficulty1 = response.data.questsByDifficulty.find(
        (c) => c.difficulty === 1,
      );
      const difficulty5 = response.data.questsByDifficulty.find(
        (c) => c.difficulty === 5,
      );

      expect(difficulty1?.count).toBe(2);
      expect(difficulty5?.count).toBe(1);
    });

    it("should return top zones", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      await createTestQuest(ctx, user, campaign.id, { zone: "backend" });
      await createTestQuest(ctx, user, campaign.id, { zone: "backend" });
      await createTestQuest(ctx, user, campaign.id, { zone: "frontend" });

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      expect(response.data.topZones).toHaveLength(2);
      expect(response.data.topZones[0].zone).toBe("backend");
      expect(response.data.topZones[0].totalQuests).toBe(2);
      expect(response.data.topZones[1].zone).toBe("frontend");
      expect(response.data.topZones[1].totalQuests).toBe(1);
    });

    it("should return overview with correct totals", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      await createTestQuest(ctx, user, campaign.id, { difficulty: 2 });
      await createTestQuest(ctx, user, campaign.id, { difficulty: 4 });

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      expect(response.data.overview.totalQuests).toBe(2);
      expect(response.data.overview.averageQuestDifficulty).toBe(3);
    });

    it("should return activity timeline", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      // Should return 365 days of timeline data
      expect(response.data.activityTimeline).toHaveLength(365);
    });

    it("should track completed quests in timeline and completion rates", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, user);

      const quest = await createTestQuest(ctx, user, campaign.id);

      // Accept then complete the quest through the controller
      await ctx.questController.acceptQuest.fetch(
        { params: { id: quest.id } },
        { user },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: quest.id } },
        { user },
      );

      const response = await ctx.statsController.getCampaignStats.fetch(
        { params: { id: campaign.id } },
        { user },
      );

      expect(response.data.overview.completedQuests).toBe(1);
      expect(response.data.completionRate.weekly).toBeGreaterThanOrEqual(1);
      expect(response.data.completionRate.monthly).toBeGreaterThanOrEqual(1);
      expect(response.data.completionRate.overall).toBe(100);
    });
  });
});
