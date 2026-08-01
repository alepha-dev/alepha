import { VITALS_BUCKETS } from "@alepha/sigil/vitals";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { InsightsController } from "../src/api/controllers/InsightsController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { members } from "../src/api/entities/members.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../src/api/entities/sigilVitalsHourly.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Writes the aggregate tables directly.
 *
 * Going through the ingest endpoint would only ever produce rows in the current
 * hour, and every assertion here is about a window.
 */
class Probe {
  members = $repository(members);
  views = $repository(sigilViewsHourly);
  uniques = $repository(sigilUniquesDaily);
  vitals = $repository(sigilVitalsHourly);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  insightsController: InsightsController;
  probe: Probe;
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

  const probe = alepha.inject(Probe);
  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    insightsController: alepha.inject(InsightsController),
    probe,
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createCampaign = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Insights", features: { beacon: true } } },
    { user },
  );
  return created.data.id;
};

const createSigil = async (
  ctx: TestContext,
  campaignId: number,
  environment: string,
  user: { id: string; roles: string[] },
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { app: "lore", environment, kinds: ["beacon", "vitals"] },
    },
    { user },
  );
  return created.data.id;
};

/** `YYYY-MM-DD` for `daysAgo` days before today, UTC. */
const dayUtc = (daysAgo: number): string => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

/** `YYYY-MM-DDTHH` for a given UTC hour of a day `daysAgo` back. */
const hourUtc = (daysAgo: number, hour: number): string =>
  `${dayUtc(daysAgo)}T${String(hour).padStart(2, "0")}`;

describe("InsightsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("totals views and unique visitors over the window", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, "prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 9),
      path: "/",
      country: "FR",
      count: 10,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(2, 13),
      path: "/about",
      country: "US",
      count: 5,
    });
    for (const visitorHash of ["h1", "h2"]) {
      await ctx.probe.uniques.create({ sigilId, day: dayUtc(0), visitorHash });
    }
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(2),
      visitorHash: "h3",
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.totalViews).toBe(15);
    expect(res.data.uniqueVisitors).toBe(3);
  });

  it("excludes rows outside the window", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, "prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 1),
      path: "/",
      country: "FR",
      count: 4,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(20, 1),
      path: "/old",
      country: "FR",
      count: 99,
    });
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(0),
      visitorHash: "h1",
    });
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(20),
      visitorHash: "old",
    });

    const week = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );
    expect(week.data.totalViews).toBe(4);
    expect(week.data.uniqueVisitors).toBe(1);

    const month = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );
    expect(month.data.totalViews).toBe(103);
    expect(month.data.uniqueVisitors).toBe(2);
  });

  it("orders top countries by views, descending", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, "prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 8),
      path: "/",
      country: "FR",
      count: 3,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 8),
      path: "/",
      country: "US",
      count: 12,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(1, 8),
      path: "/x",
      country: "FR",
      count: 4,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topCountries[0]).toEqual({ country: "US", count: 12 });
    expect(res.data.topCountries[1]).toEqual({ country: "FR", count: 7 });
  });

  it("gives each top path a count and a share of the total", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, "prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 8),
      path: "/",
      country: "FR",
      count: 30,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 8),
      path: "/about",
      country: "US",
      count: 10,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topPaths[0]).toEqual({
      path: "/",
      count: 30,
      percentage: 75,
    });
    expect(res.data.topPaths[1].percentage).toBe(25);
  });

  it("folds hour buckets into a zero-filled daily timeline", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, "prod", owner);

    // Two hours of the same day — the day point is their sum, which is the one
    // thing a `substr(hour, 1, 10)` group has to get right.
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 9),
      path: "/",
      country: "FR",
      count: 6,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(0, 17),
      path: "/",
      country: "FR",
      count: 4,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(3, 12),
      path: "/",
      country: "US",
      count: 2,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.timeline).toHaveLength(7);
    const byDate = new Map(res.data.timeline.map((p) => [p.date, p.views]));
    expect(byDate.get(dayUtc(0))).toBe(10);
    expect(byDate.get(dayUtc(3))).toBe(2);
    expect(byDate.get(dayUtc(1))).toBe(0);
  });

  it("counts a visitor seen in two environments on one day once", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const prod = await createSigil(ctx, campaignId, "prod", owner);
    const staging = await createSigil(ctx, campaignId, "staging", owner);

    await ctx.probe.uniques.create({
      sigilId: prod,
      day: dayUtc(0),
      visitorHash: "shared",
    });
    await ctx.probe.uniques.create({
      sigilId: staging,
      day: dayUtc(0),
      visitorHash: "shared",
    });
    await ctx.probe.uniques.create({
      sigilId: staging,
      day: dayUtc(0),
      visitorHash: "other",
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.uniqueVisitors).toBe(2);
  });

  it("returns an empty snapshot for a campaign with no sigils", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.totalViews).toBe(0);
    expect(res.data.topPaths).toEqual([]);
    expect(res.data.timeline).toHaveLength(7);
    expect(res.data.vitals.lcp).toBeNull();
  });

  describe("vitals p75", () => {
    it("walks the stored histogram to a p75 boundary", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilId = await createSigil(ctx, campaignId, "prod", owner);

      // 1 sample in bucket 0, 2 in bucket 2, 1 in the overflow bucket.
      // Total 4, target = ceil(0.75 × 4) = 3. Cumulative reaches 3 at bucket 2,
      // whose upper boundary is 2500.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(0, 10),
        metric: "lcp",
        path: "/",
        bucketCounts: { "0": 1, "2": 2, "6": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[2]).toBe(2500);
      expect(res.data.vitals.lcp).toBe(2500);
    });

    it("merges histograms across sigils rather than averaging percentiles", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const prod = await createSigil(ctx, campaignId, "prod", owner);
      const staging = await createSigil(ctx, campaignId, "staging", owner);

      // Fast environment: 3 samples in bucket 0. Slow one: 1 sample in the
      // overflow bucket. Merged, 4 samples with target 3 → still bucket 0's
      // boundary. Averaging the two p75s would have said otherwise.
      await ctx.probe.vitals.create({
        sigilId: prod,
        hour: hourUtc(0, 10),
        metric: "lcp",
        path: "/",
        bucketCounts: { "0": 3 },
      });
      await ctx.probe.vitals.create({
        sigilId: staging,
        hour: hourUtc(0, 11),
        metric: "lcp",
        path: "/",
        bucketCounts: { "6": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[0]).toBe(1000);
      expect(res.data.vitals.lcp).toBe(1000);
    });

    it("returns null for a metric with no sample in the window", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilId = await createSigil(ctx, campaignId, "prod", owner);

      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(20, 10),
        metric: "lcp",
        path: "/",
        bucketCounts: { "0": 5 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.lcp).toBeNull();
      expect(res.data.vitals.cls).toBeNull();
      expect(res.data.vitals.inp).toBeNull();
      expect(res.data.vitals.fcp).toBeNull();
      expect(res.data.vitals.ttfb).toBeNull();
    });

    it("reports CLS as the real score, not the ×1000 integer", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilId = await createSigil(ctx, campaignId, "prod", owner);

      // CLS is bucketed on the collector's ×1000 integer, so the boundary is
      // 50 and the score is 0.05. Undoing the scaling is the controller's job,
      // not the chart's.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(0, 10),
        metric: "cls",
        path: "/",
        bucketCounts: { "0": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.cls).toBeCloseTo(VITALS_BUCKETS.cls[0] / 1000, 10);
    });
  });

  it("lets a member read, and refuses a stranger", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await createSigil(ctx, campaignId, "prod", owner);
    await ctx.probe.members.create({ userId: member.id, campaignId });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: member },
    );
    expect(res.data.range).toBe("7d");

    await expect(
      ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});
