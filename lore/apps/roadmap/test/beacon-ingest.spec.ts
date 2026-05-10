import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaOrm, RepositoryProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BeaconController } from "../src/api/controllers/BeaconController.ts";
import { beacons } from "../src/api/entities/beacons.ts";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { RoadmapApi } from "../src/api/index.ts";

interface TestContext {
  alepha: Alepha;
  ctrl: BeaconController;
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
  alepha.with(RoadmapApi);

  await alepha.start();

  return {
    alepha,
    ctrl: alepha.inject(BeaconController),
  };
};

const seedCampaign = async (
  alepha: Alepha,
  overrides: Partial<{
    enabled: boolean;
    token: string;
    origins: string[];
    rate: number;
  }> = {},
) => {
  const repo = alepha.inject(RepositoryProvider).getRepository(campaigns);
  return repo.create({
    title: "Test",
    createdBy: "00000000-0000-0000-0000-000000000001",
    beacons: {
      enabled: overrides.enabled ?? true,
      publicToken: overrides.token ?? "pk_test_token_1234567890abcdef",
      allowedOrigins: overrides.origins ?? ["example.com"],
      rateLimitPerMin: overrides.rate,
    },
  });
};

const validBody = () => ({
  title: "x",
  description: "y",
  reportType: "bug" as const,
  context: {
    url: "https://example.com/x",
    path: "/x",
    userAgent: "ua",
    viewport: { width: 1, height: 1 },
  },
});

describe("BeaconController.submit (public ingest)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates beacon on valid token + allowed origin", async () => {
    const c = await seedCampaign(ctx.alepha);
    const res = await ctx.ctrl.submit({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
      headers: { origin: "https://example.com" },
      body: {
        title: "Login button broken",
        description: "Clicking does nothing on Safari",
        reportType: "bug",
        context: {
          url: "https://example.com/login",
          path: "/login",
          userAgent: "Mozilla/5.0",
          viewport: { width: 1280, height: 800 },
        },
      },
    });
    expect(res.id).toBeGreaterThan(0);
    const repo = ctx.alepha.inject(RepositoryProvider).getRepository(beacons);
    const stored = await repo.findById(res.id);
    expect(stored?.status).toBe("new");
    expect(stored?.title).toBe("Login button broken");
    expect(stored?.ipHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns 404 when beacons disabled", async () => {
    const c = await seedCampaign(ctx.alepha, { enabled: false });
    await expect(
      ctx.ctrl.submit({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: validBody(),
      }),
    ).rejects.toThrowError(/not found/i);
  });

  it("returns 401 on wrong token", async () => {
    const c = await seedCampaign(ctx.alepha);
    await expect(
      ctx.ctrl.submit({
        params: { campaignId: c.id },
        query: { t: "wrong" },
        headers: { origin: "https://example.com" },
        body: validBody(),
      }),
    ).rejects.toThrowError(/unauthor|invalid token/i);
  });

  it("returns 403 when origin not allowed", async () => {
    const c = await seedCampaign(ctx.alepha, { origins: ["other.com"] });
    await expect(
      ctx.ctrl.submit({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: validBody(),
      }),
    ).rejects.toThrowError(/forbidden|origin/i);
  });

  it("supports *.domain wildcard origin", async () => {
    const c = await seedCampaign(ctx.alepha, { origins: ["*.example.com"] });
    const res = await ctx.ctrl.submit({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
      headers: { origin: "https://app.example.com" },
      body: validBody(),
    });
    expect(res.id).toBeGreaterThan(0);
  });

  it("returns 429 when per-minute rate limit exceeded", async () => {
    const c = await seedCampaign(ctx.alepha, { rate: 2 });
    const call = () =>
      ctx.ctrl.submit({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: validBody(),
      });
    await call();
    await call();
    await expect(call()).rejects.toThrow(/rate limit/i);
  });

  it("returns 429 when daily cap exceeded", async () => {
    class TestBeaconController extends BeaconController {
      protected override dailyCap = 3;
    }
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
      },
    });
    alepha.with({ provide: BeaconController, use: TestBeaconController });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(RoadmapApi);
    await alepha.start();

    try {
      const c = await seedCampaign(alepha);
      const ctrl = alepha.inject(BeaconController);
      const call = () =>
        ctrl.submit({
          params: { campaignId: c.id },
          query: { t: "pk_test_token_1234567890abcdef" },
          headers: { origin: "https://example.com" },
          body: validBody(),
        });
      await call();
      await call();
      await call();
      await expect(call()).rejects.toThrow(/daily cap/i);
    } finally {
      await alepha.stop();
    }
  });
});

/**
 * Build a minimal but real JPEG-shaped buffer: SOI marker + APP0/JFIF segment
 * + EOI. Enough to satisfy a leading-bytes magic-number check (`FF D8 FF`).
 */
const jpegBuffer = () =>
  Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);

describe("BeaconController.uploadScreenshot", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const buildFile = (alepha: Alepha, buf: Buffer, type = "image/jpeg") =>
    alepha.inject(FileSystemProvider).createFile({
      buffer: buf,
      name: "shot.jpg",
      type,
    });

  it("happy path: uploadScreenshot returns a fileId, submit accepts it", async () => {
    const c = await seedCampaign(ctx.alepha);

    const uploadRes = await ctx.ctrl.uploadScreenshot({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
      headers: { origin: "https://example.com" },
      body: { file: buildFile(ctx.alepha, jpegBuffer()) },
    });
    expect(uploadRes.fileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const res = await ctx.ctrl.submit({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
      headers: { origin: "https://example.com" },
      body: { ...validBody(), screenshotFileId: uploadRes.fileId },
    });

    const repo = ctx.alepha.inject(RepositoryProvider).getRepository(beacons);
    const stored = await repo.findById(res.id);
    expect(stored?.screenshotFileId).toBe(uploadRes.fileId);
  });

  it("submit with non-existent screenshotFileId returns 400", async () => {
    const c = await seedCampaign(ctx.alepha);
    await expect(
      ctx.ctrl.submit({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: {
          ...validBody(),
          screenshotFileId: "00000000-0000-0000-0000-000000000999",
        },
      }),
    ).rejects.toThrowError(/screenshot file not found/i);
  });

  it("uploadScreenshot rejects non-JPEG bytes", async () => {
    const c = await seedCampaign(ctx.alepha);
    const notJpeg = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // PNG magic
    await expect(
      ctx.ctrl.uploadScreenshot({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: { file: buildFile(ctx.alepha, notJpeg, "image/jpeg") },
      }),
    ).rejects.toThrowError(/not a valid jpeg/i);
  });

  it("uploadScreenshot rejects wrong MIME type via bucket validation", async () => {
    const c = await seedCampaign(ctx.alepha);
    await expect(
      ctx.ctrl.uploadScreenshot({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: { file: buildFile(ctx.alepha, jpegBuffer(), "image/png") },
      }),
    ).rejects.toThrow();
  });

  it("returns 404 when beacons disabled (no rate-limit on this endpoint)", async () => {
    const c = await seedCampaign(ctx.alepha, { enabled: false });
    await expect(
      ctx.ctrl.uploadScreenshot({
        params: { campaignId: c.id },
        query: { t: "pk_test_token_1234567890abcdef" },
        headers: { origin: "https://example.com" },
        body: { file: buildFile(ctx.alepha, jpegBuffer()) },
      }),
    ).rejects.toThrowError(/not found/i);
  });
});

describe("BeaconController.serveLoader", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("emits a valid IIFE that bakes campaign id and token", async () => {
    const c = await seedCampaign(ctx.alepha);
    const js = await ctx.ctrl.serveLoader({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
    });
    expect(typeof js).toBe("string");
    expect(js.startsWith("(function(){")).toBe(true);
    expect(js).toContain(`"campaignId":${c.id}`);
    expect(js).toContain("pk_test_token_1234567890abcdef");
    expect(js).not.toContain("console.warn('[beacons] disabled");
  });

  it("returns a no-op script when the campaign is disabled", async () => {
    const c = await seedCampaign(ctx.alepha, { enabled: false });
    const js = await ctx.ctrl.serveLoader({
      params: { campaignId: c.id },
      query: { t: "pk_test_token_1234567890abcdef" },
    });
    expect(js).toContain("console.warn");
    expect(js).toContain("disabled or invalid token");
    expect(js).not.toContain("pk_test_token_1234567890abcdef");
  });

  it("returns a no-op script on token mismatch", async () => {
    const c = await seedCampaign(ctx.alepha);
    const js = await ctx.ctrl.serveLoader({
      params: { campaignId: c.id },
      query: { t: "wrong-token" },
    });
    expect(js).toContain("console.warn");
    expect(js).toContain("disabled or invalid token");
  });
});
