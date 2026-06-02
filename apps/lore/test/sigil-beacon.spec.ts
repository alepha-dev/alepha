import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
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
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  beacons: BeaconIngestService;
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
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();
  alepha.inject(ServerProvider);

  return {
    alepha,
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
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    {
      body: {
        title: "Beacons",
        features: { sigils: true, beacon: true },
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
): Promise<{ id: string }> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { label: "beacon sigil", kinds },
    },
    { user },
  );
  return { id: created.data.id };
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
});
