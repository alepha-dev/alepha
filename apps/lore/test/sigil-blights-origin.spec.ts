import { Alepha, z } from "alepha";
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
import { BlightIngestService } from "../src/api/services/BlightIngestService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  blights: BlightIngestService;
  fakeProvider: FakeProvider;
}

const ORIGIN = "https://shop.example.com";

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
        title: "Origin Test",
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
): Promise<{ id: string; ingestKey: string }> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: {
        label: "origin test sigil",
        kinds: ["blights"],
      },
    },
    { user },
  );
  const sigilService = ctx.alepha.inject(
    (await import("../src/api/services/SigilService.ts")).SigilService,
  );
  const row = await sigilService.findForIngest(created.data.id);
  return { id: created.data.id, ingestKey: row!.ingestKey };
};

const ev = () => ({
  name: "TypeError",
  message: "x is not a function",
  stack:
    "TypeError: x is not a function\n  at foo (https://shop.example.com/app.js:1:1)",
  sourceUrl: "https://shop.example.com/page",
});

describe("SigilBlight origin column", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("defaults origin to 'client' when not specified", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    await ctx.blights.ingestEvent(sigil.id, ev(), "127.0.0.1");

    const s = ctx.blights;
    const fp = s.fingerprint(
      "TypeError",
      s.sanitizeStack(ev().stack),
      sigil.id,
    );
    const row = await (s as any).blights.findOne({
      where: { sigilId: { eq: sigil.id }, fingerprint: { eq: fp } },
    });

    expect(row).toBeDefined();
    expect(row.origin).toBe("client");
  });

  it("persists 'server' when origin is explicitly set to server", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigil = await createSigil(ctx, campaignId, owner);

    // Insert a blight directly with origin: "server" via the repository.
    const blightsRepo = (ctx.blights as any).blights;
    const s = ctx.blights;
    const crash = ev();
    const sanitizedStack = s.sanitizeStack(crash.stack);
    const fp = s.fingerprint(crash.name, sanitizedStack, sigil.id);
    const now = new Date().toISOString();

    await blightsRepo.upsert(
      {
        sigilId: sigil.id,
        fingerprint: fp,
        name: crash.name,
        message: crash.message,
        stack: sanitizedStack,
        sourceUrl: crash.sourceUrl,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
        recentIps: [],
        status: "open",
        origin: "server",
      },
      {
        target: ["sigilId", "fingerprint"],
        set: { origin: "server" },
      },
    );

    const row = await blightsRepo.findOne({
      where: { sigilId: { eq: sigil.id }, fingerprint: { eq: fp } },
    });

    expect(row).toBeDefined();
    expect(row.origin).toBe("server");
  });
});
