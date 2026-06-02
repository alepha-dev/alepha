import { VITALS_BUCKETS } from "@alepha/sigil/vitals";
import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { InsightsController } from "../src/api/controllers/InsightsController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";
import { VitalsIngestService } from "../src/api/services/VitalsIngestService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  insightsController: InsightsController;
  vitals: VitalsIngestService;
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
    sigilController: alepha.inject(SigilController),
    insightsController: alepha.inject(InsightsController),
    vitals: alepha.inject(VitalsIngestService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

async function createTestUser(
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

async function createCampaign(
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Insights", features: { beacon: true } } },
    { user },
  );
  return created.data.id;
}

async function createSigil(
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
): Promise<string> {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: {
        label: "beacon sigil",
        allowedOrigins: ["https://shop.example.com"],
        kinds: ["beacon"],
      },
    },
    { user },
  );
  return created.data.id;
}

/** `YYYY-MM-DD` for `daysAgo` days before today (UTC). */
function dayUtc(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("InsightsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /** Seed sigil_views + sigil_unique_visitors rows directly via the DB. */
  async function seed(
    sigilId: string,
    views: Array<{
      date: string;
      country: string;
      path: string;
      count: number;
    }>,
    uniques: Array<{ date: string; sessionHash: string }>,
  ) {
    const { DatabaseProvider, sql } = await import("alepha/orm");
    const db = ctx.alepha.inject(DatabaseProvider);
    for (const v of views) {
      await db.execute(sql`
        INSERT INTO sigil_views (sigil_id, date, country, path, count)
        VALUES (${sigilId}, ${v.date}, ${v.country}, ${v.path}, ${v.count})
      `);
    }
    for (const u of uniques) {
      await db.execute(sql`
        INSERT INTO sigil_unique_visitors (sigil_id, date, session_hash)
        VALUES (${sigilId}, ${u.date}, ${u.sessionHash})
      `);
    }
  }

  it("totals views + unique visitors for the selected range", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    await seed(
      sigilId,
      [
        { date: dayUtc(0), country: "FR", path: "/", count: 10 },
        { date: dayUtc(2), country: "US", path: "/about", count: 5 },
      ],
      [
        { date: dayUtc(0), sessionHash: "h1" },
        { date: dayUtc(0), sessionHash: "h2" },
        { date: dayUtc(2), sessionHash: "h3" },
      ],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );
    expect(res.data.totalViews).toBe(15);
    expect(res.data.uniqueVisitors).toBe(3);
  });

  it("excludes rows outside the selected range", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    await seed(
      sigilId,
      [
        { date: dayUtc(0), country: "FR", path: "/", count: 4 },
        { date: dayUtc(20), country: "FR", path: "/old", count: 99 },
      ],
      [
        { date: dayUtc(0), sessionHash: "h1" },
        { date: dayUtc(20), sessionHash: "h-old" },
      ],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );
    expect(res.data.totalViews).toBe(4);
    expect(res.data.uniqueVisitors).toBe(1);

    const res30 = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );
    expect(res30.data.totalViews).toBe(103);
    expect(res30.data.uniqueVisitors).toBe(2);
  });

  it("top countries are ordered by view count desc", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    await seed(
      sigilId,
      [
        { date: dayUtc(0), country: "FR", path: "/", count: 3 },
        { date: dayUtc(0), country: "US", path: "/", count: 12 },
        { date: dayUtc(1), country: "FR", path: "/x", count: 4 },
      ],
      [],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );
    expect(res.data.topCountries[0]).toEqual({ country: "US", count: 12 });
    expect(res.data.topCountries[1]).toEqual({ country: "FR", count: 7 });
  });

  it("top paths carry count + percentage", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    await seed(
      sigilId,
      [
        { date: dayUtc(0), country: "FR", path: "/", count: 30 },
        { date: dayUtc(0), country: "US", path: "/about", count: 10 },
      ],
      [],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "30d" } },
      { user: owner },
    );
    expect(res.data.topPaths[0].path).toBe("/");
    expect(res.data.topPaths[0].count).toBe(30);
    expect(res.data.topPaths[0].percentage).toBe(75);
    expect(res.data.topPaths[1].path).toBe("/about");
    expect(res.data.topPaths[1].percentage).toBe(25);
  });

  it("views-over-time series spans the range with zero-filled days", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    await seed(
      sigilId,
      [
        { date: dayUtc(0), country: "FR", path: "/", count: 6 },
        { date: dayUtc(3), country: "US", path: "/", count: 2 },
      ],
      [],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );
    expect(res.data.timeline.length).toBe(7);
    const byDate = new Map(res.data.timeline.map((p) => [p.date, p.views]));
    expect(byDate.get(dayUtc(0))).toBe(6);
    expect(byDate.get(dayUtc(3))).toBe(2);
    expect(byDate.get(dayUtc(1))).toBe(0);
  });

  it("dedups a visitor seen across two sigils on the same day", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilA = await createSigil(ctx, campaignId, owner);
    const sigilB = await createSigil(ctx, campaignId, owner);

    // Same (date, session_hash) on both sigils — must count once.
    await seed(sigilA, [], [{ date: dayUtc(0), sessionHash: "shared" }]);
    await seed(
      sigilB,
      [],
      [
        { date: dayUtc(0), sessionHash: "shared" },
        { date: dayUtc(0), sessionHash: "other" },
      ],
    );

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: owner },
    );
    // "shared" once + "other" once = 2, not 3.
    expect(res.data.uniqueVisitors).toBe(2);
  });

  it("non-member is forbidden", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await createSigil(ctx, campaignId, owner);

    await expect(
      ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  describe("vitals p75", () => {
    it("returns lcp p75 for the campaign sigil within the window", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilId = await createSigil(ctx, campaignId, owner);

      // Ingest: 500 (bucket 0), 2400 ×2 (bucket 2), 99999 (overflow bucket 6).
      // Total = 4 samples. Target = ceil(0.75 × 4) = 3.
      // Walk: bucket 0 → cum 1, bucket 2 → cum 3 ≥ 3 → p75 = boundaries[2] = 2500.
      await ctx.vitals.ingestVitals(
        sigilId,
        [
          { path: "/", metric: "lcp", value: 500 },
          { path: "/", metric: "lcp", value: 2400 },
          { path: "/", metric: "lcp", value: 2400 },
          { path: "/", metric: "lcp", value: 99999 },
        ],
        dayUtc(0),
      );

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[2]).toBe(2500);
      expect(res.data.vitals.lcp).toBe(2500);
    });

    it("aggregates lcp p75 across two sigils in the same campaign", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilA = await createSigil(ctx, campaignId, owner);
      const sigilB = await createSigil(ctx, campaignId, owner);

      // Sigil A: 2 samples in bucket 0 (≤ 1000).
      await ctx.vitals.ingestVitals(
        sigilA,
        [
          { path: "/", metric: "lcp", value: 500 },
          { path: "/", metric: "lcp", value: 800 },
        ],
        dayUtc(0),
      );
      // Sigil B: 2 samples in bucket 0 as well.
      await ctx.vitals.ingestVitals(
        sigilB,
        [
          { path: "/", metric: "lcp", value: 400 },
          { path: "/", metric: "lcp", value: 900 },
        ],
        dayUtc(0),
      );

      // Combined: 4 samples all in bucket 0. Target = ceil(0.75 × 4) = 3.
      // Bucket 0 cum = 4 ≥ 3 → p75 = boundaries[0] = 1000.
      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[0]).toBe(1000);
      expect(res.data.vitals.lcp).toBe(1000);
    });

    it("returns null for a metric with no data in the range", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      await createSigil(ctx, campaignId, owner);

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

    it("returns cls ÷ 1000 (real score, not integer × 1000)", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const campaignId = await createCampaign(ctx, owner);
      const sigilId = await createSigil(ctx, campaignId, owner);

      // CLS boundaries (×1000 integers): [100, 250, …].
      // A value of 50 (raw, meaning real CLS = 0.05) → bucket 0.
      // One sample: total = 1, target = ceil(0.75) = 1 → p75 = boundaries[0] = 100.
      // After ÷ 1000 the controller returns 0.1.
      await ctx.vitals.ingestVitals(
        sigilId,
        [{ path: "/", metric: "cls", value: 50 }],
        dayUtc(0),
      );

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { campaignId }, query: { range: "7d" } },
        { user: owner },
      );

      const expectedRaw = VITALS_BUCKETS.cls[0]!;
      expect(res.data.vitals.cls).toBeCloseTo(expectedRaw / 1000, 10);
    });
  });

  it("a campaign member (non-owner) can read insights", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await createSigil(ctx, campaignId, owner);

    // Seed a non-owner character so `member` belongs to the campaign
    // (the invitation flow is more plumbing than this test needs).
    const charactersRepo = (ctx.campaignController as any).characters;
    await charactersRepo.create({
      userId: member.id,
      campaignId,
      xp: 0,
      balance: 0,
      owner: false,
    });

    // Before the fix this 403'd (owner-only) and crashed the page loader.
    const res = await ctx.insightsController.getInsights.fetch(
      { params: { campaignId }, query: { range: "7d" } },
      { user: member },
    );
    expect(res.data).toBeDefined();
  });
});
