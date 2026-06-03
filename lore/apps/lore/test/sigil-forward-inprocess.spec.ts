import { SigilForwardProvider } from "@alepha/sigil/server";
import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreSigilForwardProvider } from "../src/api/providers/LoreSigilForwardProvider.ts";
import { BlightIngestService } from "../src/api/services/BlightIngestService.ts";

/**
 * Integration coverage for `LoreSigilForwardProvider` — the in-process forward
 * provider Lore substitutes for the base HTTP one (which would self-call its
 * own Cloudflare hostname). It must resolve the campaign and forward telemetry
 * WITHOUT any HTTP, directly against Lore's own services.
 *
 * The base provider only sets its `config` (sigil id + lore origin) in a
 * production `start` hook. We don't run in production here, so a tiny test
 * subclass exposes a `configure()` to set it after the sigil exists — exactly
 * the state the provider is in once booted in prod with `SIGIL_ID` set.
 */
class TestLoreSigilForwardProvider extends LoreSigilForwardProvider {
  public configure(id: string): void {
    this.config = { id, loreOrigin: "https://lore.alepha.dev" };
  }
}

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
  blights: BlightIngestService;
  forward: TestLoreSigilForwardProvider;
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
  alepha.with({
    provide: SigilForwardProvider,
    use: TestLoreSigilForwardProvider,
  });

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    blights: alepha.inject(BlightIngestService),
    forward: alepha.inject(
      SigilForwardProvider,
    ) as TestLoreSigilForwardProvider,
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
        title: "InProc",
        features: { sigils: true, beacon: true, blights: true, vitals: true },
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
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: {
        label: "inproc sigil",
        allowedOrigins: [],
        kinds: ["beacon", "blights", "vitals"],
      },
    },
    { user },
  );
  return created.data.id;
};

describe("LoreSigilForwardProvider — in-process resolve + forward", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("resolves the campaign in-process (no HTTP) once configured", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    ctx.forward.configure(sigilId);

    expect(ctx.forward.enabled()).toBe(true);
    expect(await ctx.forward.campaignId()).toBe(campaignId);
  });

  it("returns undefined when not configured (disabled)", async ({ expect }) => {
    expect(ctx.forward.enabled()).toBe(false);
    expect(await ctx.forward.campaignId()).toBeUndefined();
  });

  it("forwards telemetry in-process → blight is persisted", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    ctx.forward.configure(sigilId);

    await ctx.forward.forwardIngest(
      {
        errors: [
          {
            name: "TypeError",
            message: "inproc-oops",
            stack:
              "TypeError: inproc-oops\n  at x (https://lore.alepha.dev/a.js:1:1)",
            sourceUrl: "https://lore.alepha.dev/page",
            origin: "client",
          },
        ],
      },
      { country: "FR", visitor: "vhash-inproc" },
    );

    const blightRows = await (ctx.blights as any).blights.findMany({
      where: { sigilId: { eq: sigilId } },
    });
    expect(blightRows.length).toBe(1);
    expect(blightRows[0].name).toBe("TypeError");
    expect(blightRows[0].message).toBe("inproc-oops");
    expect(blightRows[0].origin).toBe("client");
  });
});
