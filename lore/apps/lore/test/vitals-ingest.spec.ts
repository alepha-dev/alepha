import { VITALS_BUCKETS } from "@alepha/telemetry/vitals";
import { Alepha } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";
import { VitalsIngestService } from "../src/api/services/VitalsIngestService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  vitals: VitalsIngestService;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();
  alepha.inject(ServerProvider); // ensure server is ready

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    vitals: alepha.inject(VitalsIngestService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fake = ctx.fakeProvider.generate(
    (await import("alepha")).z.object({
      username: (await import("alepha")).z.string(),
      email: (await import("alepha")).z.email(),
    }),
  );
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createCampaignWithSigil = async (
  ctx: TestContext,
): Promise<{ sigilId: string }> => {
  const user = await createTestUser(ctx);
  const campaign = await ctx.campaignController.createCampaign.fetch(
    {
      body: { title: "Vitals Test", features: { sigils: true, beacon: true } },
    },
    { user },
  );
  const sigilRes = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId: campaign.data.id },
      body: {
        label: "vitals sigil",
        kinds: ["beacon"],
      },
    },
    { user },
  );
  return { sigilId: sigilRes.data.id };
};

describe("VitalsIngestService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("ingestVitals", () => {
    it("buckets samples correctly and upserts counts", async ({ expect }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);
      const date = "2026-06-01";

      // LCP boundaries: [1000, 1800, 2500, 3000, 4000, 6000]
      // 500  → bucket 0 (≤ 1000)
      // 2400 → bucket 2 (≤ 2500)
      // 2400 → bucket 2 (same as above, count += 1)
      // 99999 → overflow = bucket 6 (boundaries.length)
      await ctx.vitals.ingestVitals(
        sigilId,
        [
          { path: "/x", metric: "lcp", value: 500 },
          { path: "/x", metric: "lcp", value: 2400 },
          { path: "/x", metric: "lcp", value: 2400 },
          { path: "/x", metric: "lcp", value: 99999 },
        ],
        date,
      );

      // Access the internal repository directly for assertions.
      const vitalsRepo = (ctx.vitals as any).vitals;
      const rows = await vitalsRepo.findMany({
        where: { sigilId: { eq: sigilId }, date: { eq: date } },
        orderBy: { column: "bucket", direction: "asc" },
      });

      expect(rows.length).toBe(3);
      expect(rows[0].bucket).toBe(0);
      expect(rows[0].count).toBe(1);
      expect(rows[1].bucket).toBe(2);
      expect(rows[1].count).toBe(2);
      expect(rows[2].bucket).toBe(6); // overflow = VITALS_BUCKETS.lcp.length
      expect(rows[2].count).toBe(1);
    });

    it("drops samples with an unknown metric", async ({ expect }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);
      const date = "2026-06-01";

      await ctx.vitals.ingestVitals(
        sigilId,
        [{ path: "/x", metric: "unknown" as any, value: 500 }],
        date,
      );

      const vitalsRepo = (ctx.vitals as any).vitals;
      const count = await vitalsRepo.count({ sigilId: { eq: sigilId } });
      expect(count).toBe(0);
    });

    it("enforces the 100-path-per-day cap, dropping paths beyond it", async ({
      expect,
    }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);
      const date = "2026-06-01";

      // Ingest 100 distinct paths.
      const samples = Array.from({ length: 100 }, (_, i) => ({
        path: `/p${i}`,
        metric: "lcp" as const,
        value: 500,
      }));
      await ctx.vitals.ingestVitals(sigilId, samples, date);

      const vitalsRepo = (ctx.vitals as any).vitals;
      const before = await vitalsRepo.count({ sigilId: { eq: sigilId } });
      expect(before).toBe(100);

      // 101st distinct path: must be dropped.
      await ctx.vitals.ingestVitals(
        sigilId,
        [{ path: "/extra", metric: "lcp", value: 500 }],
        date,
      );
      const after = await vitalsRepo.count({ sigilId: { eq: sigilId } });
      expect(after).toBe(100);
    });
  });

  describe("computeP75", () => {
    it("returns the correct p75 bucket boundary", async ({ expect }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);
      const date = "2026-06-01";

      // Ingest: 500 (bucket 0), 2400 (bucket 2), 2400 (bucket 2), 99999 (bucket 6 overflow).
      // Total = 4 samples. Target = ceil(0.75 × 4) = 3.
      // Walk buckets asc:
      //   bucket 0 → cum 1 (< 3)
      //   bucket 2 → cum 3 (≥ 3) → hit! upper boundary = VITALS_BUCKETS.lcp[2] = 2500
      await ctx.vitals.ingestVitals(
        sigilId,
        [
          { path: "/x", metric: "lcp", value: 500 },
          { path: "/x", metric: "lcp", value: 2400 },
          { path: "/x", metric: "lcp", value: 2400 },
          { path: "/x", metric: "lcp", value: 99999 },
        ],
        date,
      );

      const p75 = await ctx.vitals.computeP75(sigilId, "/x", "lcp", {
        from: date,
        to: date,
      });

      // Confirm against the real constant so the test breaks if boundaries change.
      expect(VITALS_BUCKETS.lcp[2]).toBe(2500);
      expect(p75).toBe(2500);
    });

    it("returns null when no samples exist for the metric", async ({
      expect,
    }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);

      const p75 = await ctx.vitals.computeP75(sigilId, null, "fcp");
      expect(p75).toBeNull();
    });

    it("aggregates across all paths when path is null", async ({ expect }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);
      const date = "2026-06-01";

      // Two paths, same metric. Total 2 samples in bucket 0.
      // Target = ceil(0.75 × 2) = 2. Walk: bucket 0 cum = 2 ≥ 2 → p75 = boundaries[0] = 1000.
      await ctx.vitals.ingestVitals(
        sigilId,
        [
          { path: "/a", metric: "lcp", value: 500 },
          { path: "/b", metric: "lcp", value: 800 },
        ],
        date,
      );

      const p75 = await ctx.vitals.computeP75(sigilId, null, "lcp", {
        from: date,
        to: date,
      });

      expect(VITALS_BUCKETS.lcp[0]).toBe(1000);
      expect(p75).toBe(1000);
    });

    it("respects date range filters", async ({ expect }) => {
      const { sigilId } = await createCampaignWithSigil(ctx);

      // Day 1: LCP = 500 (bucket 0)
      await ctx.vitals.ingestVitals(
        sigilId,
        [{ path: "/x", metric: "lcp", value: 500 }],
        "2026-06-01",
      );
      // Day 2: LCP = 99999 (bucket 6, overflow)
      await ctx.vitals.ingestVitals(
        sigilId,
        [{ path: "/x", metric: "lcp", value: 99999 }],
        "2026-06-02",
      );

      // Query only day 1: total = 1, target = ceil(0.75) = 1, bucket 0 → p75 = 1000.
      const p75Day1 = await ctx.vitals.computeP75(sigilId, "/x", "lcp", {
        from: "2026-06-01",
        to: "2026-06-01",
      });
      expect(p75Day1).toBe(VITALS_BUCKETS.lcp[0]); // 1000
    });
  });
});
