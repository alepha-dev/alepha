import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm, sql } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
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
  vitalsService: VitalsIngestService;
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
  // LoreApi includes VitalsIngestService which registers $repository(sigilVitals).
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    vitalsService: alepha.inject(VitalsIngestService),
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

const createSigil = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: {
        label: "vitals test sigil",
        allowedOrigins: ["https://example.com"],
        kinds: ["beacon"],
      },
    },
    { user },
  );
  return created.data.id;
};

describe("sigilVitals entity", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("inserts one row and reads all fields back", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = (
      await ctx.campaignController.createCampaign.fetch(
        { body: { title: "Vitals Campaign" } },
        { user: owner },
      )
    ).data.id;
    const sigilId = await createSigil(ctx, campaignId, owner);

    const vitals = (ctx.vitalsService as any).vitals;

    await vitals.create({
      sigilId,
      date: "2026-06-02",
      path: "/home",
      metric: "lcp",
      bucket: 2,
      count: 1,
    });

    const rows = await vitals.findMany({ where: { sigilId: { eq: sigilId } } });
    expect(rows.length).toBe(1);

    const row = rows[0];
    expect(row.sigilId).toBe(sigilId);
    expect(row.date).toBe("2026-06-02");
    expect(row.path).toBe("/home");
    expect(row.metric).toBe("lcp");
    expect(row.bucket).toBe(2);
    expect(row.count).toBe(1);
  });

  it("upserts increment count on duplicate (sigilId, date, path, metric, bucket)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = (
      await ctx.campaignController.createCampaign.fetch(
        { body: { title: "Vitals Upsert Campaign" } },
        { user: owner },
      )
    ).data.id;
    const sigilId = await createSigil(ctx, campaignId, owner);

    const vitals = (ctx.vitalsService as any).vitals;

    const row = {
      sigilId,
      date: "2026-06-02",
      path: "/checkout",
      metric: "inp",
      bucket: 1,
      count: 1,
    };

    // First insert.
    await vitals.upsert(row, {
      target: ["sigilId", "date", "path", "metric", "bucket"],
      set: { count: sql`${vitals.table.count} + 1` },
    });

    // Second insert — same key, increments count.
    await vitals.upsert(row, {
      target: ["sigilId", "date", "path", "metric", "bucket"],
      set: { count: sql`${vitals.table.count} + 1` },
    });

    const rows = await vitals.findMany({ where: { sigilId: { eq: sigilId } } });
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(2);
  });

  it("stores separate rows for different metrics on the same path", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = (
      await ctx.campaignController.createCampaign.fetch(
        { body: { title: "Multi-metric Campaign" } },
        { user: owner },
      )
    ).data.id;
    const sigilId = await createSigil(ctx, campaignId, owner);

    const vitals = (ctx.vitalsService as any).vitals;

    const metrics = ["lcp", "cls", "inp", "fcp", "ttfb"] as const;
    for (const metric of metrics) {
      await vitals.create({
        sigilId,
        date: "2026-06-02",
        path: "/shop",
        metric,
        bucket: 0,
        count: 1,
      });
    }

    const rows = await vitals.findMany({ where: { sigilId: { eq: sigilId } } });
    expect(rows.length).toBe(metrics.length);

    const storedMetrics = rows.map((r: { metric: string }) => r.metric).sort();
    expect(storedMetrics).toEqual([...metrics].sort());
  });
});
