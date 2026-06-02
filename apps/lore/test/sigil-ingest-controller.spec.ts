import { Alepha, t } from "alepha";
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
import { BeaconIngestService } from "../src/api/services/BeaconIngestService.ts";
import { BlightIngestService } from "../src/api/services/BlightIngestService.ts";
import { VitalsIngestService } from "../src/api/services/VitalsIngestService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  beacons: BeaconIngestService;
  blights: BlightIngestService;
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
  const server = alepha.inject(ServerProvider);

  return {
    alepha,
    baseUrl: server.hostname,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    beacons: alepha.inject(BeaconIngestService),
    blights: alepha.inject(BlightIngestService),
    vitals: alepha.inject(VitalsIngestService),
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
  features: {
    sigils?: boolean;
    beacon?: boolean;
    blights?: boolean;
    vitals?: boolean;
  } = { sigils: true, beacon: true, blights: true, vitals: true },
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    {
      body: {
        title: "Ingest",
        features,
      },
    },
    { user },
  );
  return created.data.id;
};

const createSigil = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
  kinds: ("petition" | "blights" | "beacon" | "vitals")[] = [
    "beacon",
    "blights",
    "vitals",
  ],
): Promise<{ id: string; ingestKey: string }> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { label: "ingest sigil", allowedOrigins: [], kinds },
    },
    { user },
  );
  const sigilService = ctx.alepha.inject(
    (await import("../src/api/services/SigilService.ts")).SigilService,
  );
  const row = await sigilService.findForEmbed(created.data.id);
  return { id: created.data.id, ingestKey: row!.ingestKey };
};

const post = async (
  ctx: TestContext,
  sigilId: string,
  body: unknown,
): Promise<Response> => {
  return fetch(`${ctx.baseUrl}/sigils/${sigilId}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("SigilIngestController — POST /sigils/:id/ingest", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("ingests a view, an error, and a vital in one call and persists all three", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await post(ctx, sigil.id, {
      country: "FR",
      visitor: "vhash",
      views: [{ path: "/home" }],
      errors: [
        {
          name: "TypeError",
          message: "oops",
          stack:
            "TypeError: oops\n  at broken (https://shop.example.com/app.js:1:1)",
          sourceUrl: "https://shop.example.com/page",
          origin: "client",
        },
      ],
      vitals: [{ path: "/home", metric: "lcp", value: 1500 }],
    });
    expect(res.status).toBe(204);

    // --- sigilViews row with country FR ---
    const views = (ctx.beacons as any).views;
    const viewRows = await views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(viewRows.length).toBe(1);
    expect(viewRows[0].path).toBe("/home");
    expect(viewRows[0].country).toBe("FR");

    // --- sigilUniqueVisitors row with sessionHash "vhash" ---
    const uniques = (ctx.beacons as any).uniques;
    const uniqueRows = await uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(uniqueRows.length).toBe(1);
    expect(uniqueRows[0].sessionHash).toBe("vhash");

    // --- sigilBlights row with origin "client" ---
    const blightRows = await (ctx.blights as any).blights.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(blightRows.length).toBe(1);
    expect(blightRows[0].origin).toBe("client");
    expect(blightRows[0].name).toBe("TypeError");

    // --- sigilVitals row ---
    const vitalRows = await (ctx.vitals as any).vitals.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(vitalRows.length).toBe(1);
    expect(vitalRows[0].metric).toBe("lcp");
    expect(vitalRows[0].path).toBe("/home");
  });

  it("404 for an unknown sigil id", async ({ expect }) => {
    const res = await post(ctx, crypto.randomUUID(), {
      views: [{ path: "/x" }],
    });
    expect(res.status).toBe(404);
  });

  it("403 when the campaign sigils master toggle is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner, {
      sigils: false,
      beacon: true,
      blights: true,
    });
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await post(ctx, sigil.id, {
      views: [{ path: "/home" }],
    });
    expect(res.status).toBe(403);

    // Nothing was written.
    const count = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(count).toBe(0);
  });

  it("skips views when the sigil lacks the beacon kind", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    // Sigil only has blights kind — no beacon.
    const sigil = await createSigil(ctx, campaignId, owner, ["blights"]);

    const res = await post(ctx, sigil.id, {
      country: "DE",
      visitor: "vhash2",
      views: [{ path: "/shop" }],
    });
    // The endpoint still returns 204 — it silently skips the capability.
    expect(res.status).toBe(204);

    // No view row should have been written.
    const count = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(count).toBe(0);
  });

  it("skips views when the campaign beacon feature is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner, {
      sigils: true,
      beacon: false,
      blights: true,
    });
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await post(ctx, sigil.id, {
      views: [{ path: "/home" }],
    });
    expect(res.status).toBe(204);

    const count = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(count).toBe(0);
  });

  it("unique-visitor row is not written when visitor is absent", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await post(ctx, sigil.id, {
      country: "US",
      views: [{ path: "/no-visitor" }],
    });
    expect(res.status).toBe(204);

    // View was recorded.
    const viewCount = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(viewCount).toBe(1);

    // But no unique-visitor row.
    const uniqueCount = await (ctx.beacons as any).uniques.count({
      sigilId: { eq: sigil.id },
    });
    expect(uniqueCount).toBe(0);
  });
});
