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
  fakeProvider: FakeProvider;
}

const ORIGIN = "https://shop.example.com";

const setup = async (
  envOverrides: Record<string, string> = {},
): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      ...envOverrides,
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
  beaconOn = true,
  sigilsOn = true,
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    {
      body: {
        title: "Beacons",
        features: { sigils: sigilsOn, beacon: beaconOn },
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
  kinds: ("petition" | "blights" | "beacon")[] = ["beacon"],
): Promise<{ id: string; ingestKey: string }> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { label: "beacon sigil", allowedOrigins: [ORIGIN], kinds },
    },
    { user },
  );
  const sigilService = ctx.alepha.inject(
    (await import("../src/api/services/SigilService.ts")).SigilService,
  );
  const row = await sigilService.findForEmbed(created.data.id);
  return { id: created.data.id, ingestKey: row!.ingestKey };
};

const ping = async (
  ctx: TestContext,
  sigilId: string,
  body: unknown,
  opts: { origin?: string; ua?: string; keyHeader?: string } = {},
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: opts.origin ?? ORIGIN,
    "user-agent": opts.ua ?? "Mozilla/5.0 (real browser)",
  };
  if (opts.keyHeader) headers["x-sigil-key"] = opts.keyHeader;
  return fetch(`${ctx.baseUrl}/sigils/${sigilId}/beacon`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("Beacons ingestion", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("sessionHash is deterministic and rotates with the day-salt", ({
    expect,
  }) => {
    const s = ctx.beacons;
    const a = s.sessionHash("sig-1", "1.2.3.4", "UA", "2026-05-20");
    const b = s.sessionHash("sig-1", "1.2.3.4", "UA", "2026-05-20");
    expect(a).toBe(b);
    // Different UTC day → different hash (not cross-day-linkable).
    expect(s.sessionHash("sig-1", "1.2.3.4", "UA", "2026-05-21")).not.toBe(a);
    // Different sigil / ip / UA → different hash.
    expect(s.sessionHash("sig-2", "1.2.3.4", "UA", "2026-05-20")).not.toBe(a);
    expect(s.sessionHash("sig-1", "9.9.9.9", "UA", "2026-05-20")).not.toBe(a);
    expect(s.sessionHash("sig-1", "1.2.3.4", "X", "2026-05-20")).not.toBe(a);
  });

  it("normalizePath drops query + fragment", ({ expect }) => {
    const s = ctx.beacons;
    expect(s.normalizePath("/products?id=42#reviews")).toBe("/products");
    expect(s.normalizePath("/a#x")).toBe("/a");
    expect(s.normalizePath(undefined)).toBe("/");
    expect(s.normalizePath("")).toBe("/");
  });

  it("aggregates the same path: two pings → one row, count 2", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const r1 = await ping(ctx, sigil.id, {
      ingestKey: sigil.ingestKey,
      path: "/home",
    });
    expect(r1.status).toBe(204);
    await ping(ctx, sigil.id, { ingestKey: sigil.ingestKey, path: "/home" });

    const views = (ctx.beacons as any).views;
    const rows = await views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].path).toBe("/home");
    // No raw IP anywhere on the row.
    expect(rows[0].country).toBe("ZZ");
  });

  it("query + fragment collapse to the same aggregated path", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    await ping(ctx, sigil.id, { ingestKey: sigil.ingestKey, path: "/p?a=1" });
    await ping(ctx, sigil.id, { ingestKey: sigil.ingestKey, path: "/p#top" });

    const views = (ctx.beacons as any).views;
    const rows = await views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe("/p");
    expect(rows[0].count).toBe(2);
  });

  it("caps distinct paths per sigil per day at 100, dropping the 101st", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);
    const s = ctx.beacons;

    for (let i = 0; i < 100; i++) {
      const out = await s.ingestPing(
        sigil.id,
        { path: `/p${i}` },
        "1.2.3.4",
        "UA",
        "ZZ",
      );
      expect(out).toBe("recorded");
    }

    // 101st distinct path → view aggregation dropped.
    const capped = await s.ingestPing(
      sigil.id,
      { path: "/p100" },
      "1.2.3.4",
      "UA",
      "ZZ",
    );
    expect(capped).toBe("path-capped");

    // An already-known path still aggregates after the cap is reached.
    const known = await s.ingestPing(
      sigil.id,
      { path: "/p0" },
      "1.2.3.4",
      "UA",
      "ZZ",
    );
    expect(known).toBe("recorded");

    const views = (ctx.beacons as any).views;
    const distinct = await views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    // 100 rows max — the 101st path never created a row.
    expect(distinct.length).toBe(100);
  });

  it("unique-visitor dedup: same sessionHash twice → one row", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);
    const s = ctx.beacons;

    // Same ip + UA → same sessionHash for the day.
    await s.ingestPing(sigil.id, { path: "/a" }, "1.2.3.4", "UA", "ZZ");
    await s.ingestPing(sigil.id, { path: "/b" }, "1.2.3.4", "UA", "ZZ");

    const uniques = (s as any).uniques;
    const visitorRows = await uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(visitorRows.length).toBe(1);

    // A different visitor (different IP) → a second unique-visitor row.
    await s.ingestPing(sigil.id, { path: "/a" }, "9.9.9.9", "UA", "ZZ");
    const after = await uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(after.length).toBe(2);
  });

  it("path-capped pings still record the unique visitor", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);
    const s = ctx.beacons;

    for (let i = 0; i < 100; i++) {
      await s.ingestPing(sigil.id, { path: `/p${i}` }, "1.2.3.4", "UA", "ZZ");
    }
    // A brand-new visitor hits a brand-new (capped) path.
    const out = await s.ingestPing(
      sigil.id,
      { path: "/p100" },
      "5.5.5.5",
      "UA",
      "ZZ",
    );
    expect(out).toBe("path-capped");

    const uniques = (s as any).uniques;
    const rows = await uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    // Two distinct visitors recorded despite the view cap.
    expect(rows.length).toBe(2);
  });

  it("stores cf-ipcountry, never the raw IP", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    await fetch(`${ctx.baseUrl}/sigils/${sigil.id}/beacon`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": "Mozilla/5.0 (real browser)",
        "cf-ipcountry": "FR",
        "x-sigil-key": sigil.ingestKey,
      },
      body: JSON.stringify({ path: "/fr-page" }),
    });

    const views = (ctx.beacons as any).views;
    const rows = await views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].country).toBe("FR");
  });

  it("accepts ingestKey via X-Sigil-Key header", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(
      ctx,
      sigil.id,
      { path: "/x" },
      { keyHeader: sigil.ingestKey },
    );
    expect(res.status).toBe(204);
  });

  it("rejects a bad ingestKey with 403 and stores nothing", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(ctx, sigil.id, {
      ingestKey: "wrong-key",
      path: "/x",
    });
    expect(res.status).toBe(403);

    const count = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(count).toBe(0);
  });

  it("drops bot-UA requests with 204 and stores nothing", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(
      ctx,
      sigil.id,
      { ingestKey: sigil.ingestKey, path: "/x" },
      { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" },
    );
    expect(res.status).toBe(204);
    const count = await (ctx.beacons as any).views.count({
      sigilId: { eq: sigil.id },
    });
    expect(count).toBe(0);
  });

  it("DISABLE_BOT_CHECK escape hatch ingests a known-bot UA", async ({
    expect,
  }) => {
    const hatched = await setup({ DISABLE_BOT_CHECK: "1" });
    try {
      expect(hatched.beacons.isBotCheckDisabled()).toBe(true);

      const owner = await createTestUser(hatched);
      const campaignId = await createCampaign(hatched, owner);
      const sigil = await createSigil(hatched, campaignId, owner);

      const res = await ping(
        hatched,
        sigil.id,
        { ingestKey: sigil.ingestKey, path: "/x" },
        { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" },
      );
      expect(res.status).toBe(204);
      const count = await (hatched.beacons as any).views.count({
        sigilId: { eq: sigil.id },
      });
      expect(count).toBe(1);
    } finally {
      await hatched.alepha.stop();
    }
  });

  it("403 when the campaign beacon feature is off", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner, false);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(ctx, sigil.id, {
      ingestKey: sigil.ingestKey,
      path: "/x",
    });
    expect(res.status).toBe(403);
  });

  it("403 when the campaign sigils master toggle is off (even if beacon on)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    // beacon ON, but the sigils master toggle OFF.
    const campaignId = await createCampaign(ctx, owner, true, false);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(ctx, sigil.id, {
      ingestKey: sigil.ingestKey,
      path: "/x",
    });
    expect(res.status).toBe(403);
  });

  it("403 when the sigil lacks the beacon capability", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner, ["petition"]);

    const res = await ping(ctx, sigil.id, {
      ingestKey: sigil.ingestKey,
      path: "/x",
    });
    expect(res.status).toBe(403);
  });

  it("403 when the Origin is not allow-listed", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const res = await ping(
      ctx,
      sigil.id,
      { ingestKey: sigil.ingestKey, path: "/x" },
      { origin: "https://evil.example.com" },
    );
    expect(res.status).toBe(403);
  });

  it("404 missing sigil, 404 deleted sigil", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    const missing = await ping(ctx, crypto.randomUUID(), {
      ingestKey: "k",
      path: "/x",
    });
    expect(missing.status).toBe(404);

    // Sigils are hard-deleted — a deleted sigil is just a 404, no 410.
    await ctx.sigilController.deleteSigil.fetch(
      { params: { campaignId, id: sigil.id } },
      { user: owner },
    );
    const deleted = await ping(ctx, sigil.id, {
      ingestKey: sigil.ingestKey,
      path: "/x",
    });
    expect(deleted.status).toBe(404);
  });
});
