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
  // Pre-unlock the Chronicles feature (#74/#77) so the stats endpoint
  // under test isn't blocked by the paywall — these specs assert the
  // aggregation, not the gate. The paywall has its own coverage.
  // biome-ignore lint/suspicious/noExplicitAny: ORM repo generic too strict
  const campaignsRepo: any = (ctx.campaignController as any).campaigns;
  const campaign = await campaignsRepo.getOne({
    where: { id: { eq: response.data.id } },
  });
  campaign.unlockedFeatures = ["chronicles"];
  await campaignsRepo.save(campaign);
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

  describe("getChroniclesOverview", () => {
    /**
     * Builds a campaign with quests in mixed lifecycle states: one
     * completed (accepted + completed), one accepted-only, one brand-new.
     * Chronicles is unlocked by `createTestCampaign`.
     */
    const setupChroniclesCampaign = async () => {
      const owner = await createTestUser(ctx);
      const campaign = await createTestCampaign(ctx, owner);

      // Completed quest — accepted then completed.
      const done = await createTestQuest(ctx, owner, campaign.id, {
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
      const accepted = await createTestQuest(ctx, owner, campaign.id, {
        title: "Accepted Quest",
        zone: "core",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: accepted.id } },
        { user: owner },
      );

      // Brand-new quest.
      await createTestQuest(ctx, owner, campaign.id, {
        title: "New Quest",
        zone: "frontend",
      });

      return {
        campaignId: campaign.id,
        owner,
        controller: ctx.statsController,
      };
    };

    it("getChroniclesOverview returns KPIs, burn-up and attention counts", async ({
      expect,
    }) => {
      const c = await setupChroniclesCampaign();
      const res = await c.controller.getChroniclesOverview.fetch(
        { params: { id: c.campaignId } },
        { user: c.owner },
      );
      expect(res.data.kpis.totalQuests).toBeGreaterThanOrEqual(3);
      expect(res.data.kpis.openQuests).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.data.burnup)).toBe(true);
      expect(res.data.attention).toHaveProperty("staleQuests");
    });

    it("getChroniclesQuests returns the funnel, breakdowns and aging list", async ({
      expect,
    }) => {
      const ctx = await setupChroniclesCampaign();
      const res = await ctx.controller.getChroniclesQuests.fetch(
        { params: { id: ctx.campaignId } },
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

    it("getChroniclesParty returns the leaderboard and contribution series", async ({
      expect,
    }) => {
      const ctx = await setupChroniclesCampaign();
      const res = await ctx.controller.getChroniclesParty.fetch(
        { params: { id: ctx.campaignId } },
        { user: ctx.owner },
      );
      expect(Array.isArray(res.data.leaderboard)).toBe(true);
      expect(Array.isArray(res.data.contributors)).toBe(true);
      expect(Array.isArray(res.data.contribution)).toBe(true);
    });
  });
});
