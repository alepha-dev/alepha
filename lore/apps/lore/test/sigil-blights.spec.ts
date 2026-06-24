import { Alepha, z } from "alepha";
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
import { BlightIngestService } from "../src/api/services/BlightIngestService.ts";
import { isBotUserAgent } from "../src/api/services/bot-ua-patterns.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  blights: BlightIngestService;
  fakeProvider: FakeProvider;
}

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
    blights: alepha.inject(BlightIngestService),
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
        title: "Blights",
        features: { sigils: true, blights: true },
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
  kinds: ("petition" | "blights" | "beacon")[] = ["blights"],
): Promise<{ id: string }> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { label: "blight sigil", kinds },
    },
    { user },
  );
  return { id: created.data.id };
};

const ev = (over: Record<string, string> = {}) => ({
  name: "TypeError",
  message: "x is not a function",
  stack:
    "TypeError: x is not a function\n  at foo (https://shop.example.com/app.js:1:1)",
  sourceUrl: "https://shop.example.com/page",
  ...over,
});

describe("Blights ingestion", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("fingerprint is stable for the same root cause, distinct otherwise", ({
    expect,
  }) => {
    const s = ctx.blights;
    const stack = "TypeError: boom\n  at foo (a.js:1:1)";
    const a = s.fingerprint("TypeError", stack, "sigil-1");
    const b = s.fingerprint("TypeError", stack, "sigil-1");
    expect(a).toBe(b);
    // Different sigil → different fingerprint (scoping).
    expect(s.fingerprint("TypeError", stack, "sigil-2")).not.toBe(a);
    // Different throw-site frame → different fingerprint.
    expect(
      s.fingerprint(
        "TypeError",
        "TypeError: boom\n  at bar (b.js:2:2)",
        "sigil-1",
      ),
    ).not.toBe(a);
    // Different error name → different fingerprint.
    expect(s.fingerprint("RangeError", stack, "sigil-1")).not.toBe(a);
  });

  it("fingerprint keys on the throw-site frame, not the volatile header message", ({
    expect,
  }) => {
    const s = ctx.blights;
    // Same root cause (same throw-site frame), different interpolated
    // message — must collapse into ONE fingerprint so dedup works.
    const a = s.fingerprint(
      "TypeError",
      "TypeError: cannot read 'id' of undefined\n  at render (app.js:42:9)",
      "sigil-1",
    );
    const b = s.fingerprint(
      "TypeError",
      "TypeError: cannot read 'name' of undefined\n  at render (app.js:42:9)",
      "sigil-1",
    );
    expect(a).toBe(b);
  });

  it("fingerprint is stable across deploys (bundler content hashes + line:col shift)", ({
    expect,
  }) => {
    const s = ctx.blights;
    // Same root cause emitted before and after a redeploy: only the Vite
    // content hash and the :line:col in the throw-site frame differ.
    const a = s.fingerprint(
      "HttpError",
      "HttpError: Internal Server Error\n    at dK.responseData (https://lore.alepha.dev/entry.iHryQ0pA.js:65:14966)",
      "sigil-1",
    );
    const b = s.fingerprint(
      "HttpError",
      "HttpError: Internal Server Error\n    at dK.responseData (https://lore.alepha.dev/entry.BheAoMVC.js:67:15102)",
      "sigil-1",
    );
    expect(a).toBe(b);
  });

  it("fingerprint falls back to the first non-empty line when no 'at' frame exists", ({
    expect,
  }) => {
    const s = ctx.blights;
    // Non-V8 trace (no `at ` frames): fall back to first non-empty line.
    const stack = "Error: something broke\n<anonymous> @ vendor.js";
    const a = s.fingerprint("Error", stack, "sigil-1");
    const b = s.fingerprint("Error", stack, "sigil-1");
    expect(a).toBe(b);
    // A genuinely different first line → different fingerprint.
    expect(
      s.fingerprint("Error", "Error: other thing\n<anonymous>", "sigil-1"),
    ).not.toBe(a);
    // An empty stack still produces a stable fingerprint.
    expect(s.fingerprint("Error", "", "sigil-1")).toBe(
      s.fingerprint("Error", "", "sigil-1"),
    );
  });

  it("sanitizeStack strips query strings and truncates at 4 KB", ({
    expect,
  }) => {
    const s = ctx.blights;
    const sanitized = s.sanitizeStack(
      "at f (https://x.com/app.js?token=SECRET&a=1:1:1)",
    );
    expect(sanitized).not.toContain("SECRET");
    expect(sanitized).not.toContain("token=");
    expect(sanitized).toContain("https://x.com/app.js");
    expect(s.sanitizeStack("x".repeat(10_000)).length).toBe(4_096);
  });

  it("isBotUserAgent flags crawlers and empty UAs, passes real browsers", ({
    expect,
  }) => {
    expect(isBotUserAgent("Googlebot/2.1")).toBe(true);
    expect(isBotUserAgent("HeadlessChrome/120")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit Safari")).toBe(
      false,
    );
  });

  it("novelty rate limit: caps NEW fingerprints per IP/day, known ones keep counting", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);
    const s = ctx.blights;
    const ip = "203.0.113.7";

    // 10 distinct new fingerprints — all accepted.
    for (let i = 0; i < 10; i++) {
      const out = await s.ingestEvent(
        sigil.id,
        ev({
          message: `crash ${i}`,
          stack: `Error: c${i}\n  at f${i} (a.js:1:1)`,
        }),
        ip,
      );
      expect(out).toBe("recorded");
    }

    // 11th NEW fingerprint from the same IP → rate-limited (dropped).
    const eleventh = await s.ingestEvent(
      sigil.id,
      ev({ stack: "Error: novel\n  at z (b.js:9:9)" }),
      ip,
    );
    expect(eleventh).toBe("rate-limited");

    // A repeat of an ALREADY-KNOWN fingerprint from the capped IP still
    // records — the cap is on novelty intake, never throughput.
    const repeat = await s.ingestEvent(
      sigil.id,
      ev({ stack: "Error: c0\n  at f0 (a.js:1:1)" }),
      ip,
    );
    expect(repeat).toBe("recorded");

    const fp = s.fingerprint(
      "TypeError",
      "Error: c0\n  at f0 (a.js:1:1)",
      sigil.id,
    );
    const row = await (s as any).blights.findOne({
      where: { sigilId: { eq: sigil.id }, fingerprint: { eq: fp } },
    });
    expect(row.count).toBe(2);

    // A different IP gets its own fresh novelty budget.
    const otherIp = await s.ingestEvent(
      sigil.id,
      ev({ stack: "Error: novel\n  at z (b.js:9:9)" }),
      "198.51.100.4",
    );
    expect(otherIp).toBe("recorded");
  });
});
