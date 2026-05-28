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
import { SigilService } from "../src/api/services/SigilService.ts";

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
  sigilService: SigilService;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      // Random port — a real HTTP server is needed: `$route` has no
      // `.fetch()` direct-invoke shim like `$action`.
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
    sigilService: alepha.inject(SigilService),
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
  sigilsOn = true,
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Sigil Embed", features: { sigils: sigilsOn } } },
    { user },
  );
  return created.data.id;
};

describe("Sigil embed script route", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("serves a live sigil as text/javascript with the cache header and baked manifest", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: {
          label: "shop.example.com",
          allowedOrigins: ["https://shop.example.com"],
          kinds: ["petition", "blights"],
        },
      },
      { user: owner },
    );
    const id = created.data.id;

    const res = await fetch(`${ctx.baseUrl}/sigils/${id}/embed.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    const body = await res.text();
    // The public sigil id is baked in.
    expect(body).toContain(id);
    // The kinds manifest is baked in.
    expect(body).toContain("petition");
    expect(body).toContain("blights");
    // Capability dispatch + Shadow DOM + console-tail skeleton present.
    expect(body).toContain("attachShadow");
    expect(body).toContain("postMessage");
    expect(body.toLowerCase()).toContain("console");
    // Well-formed: non-empty, under the 10 KB budget. Quest #88 wired the
    // html2canvas lazy-load + postMessage exchange; quest #90 added the
    // blights error-capture + batched POST — both grew the bundle.
    expect(body.length).toBeGreaterThan(100);
    expect(body.length).toBeLessThan(12 * 1024);
  });

  it("bakes the ingestKey into the served body (semi-public by design)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "key test" } },
      { user: owner },
    );

    const row = await ctx.sigilService.findForEmbed(created.data.id);
    expect(row).toBeDefined();

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
    );
    const body = await res.text();
    expect(body).toContain(row!.ingestKey);
  });

  it("returns 404 for a deleted sigil", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "delete me" } },
      { user: owner },
    );
    // Sigils are hard-deleted — a deleted sigil is just a 404, no 410.
    await ctx.sigilController.deleteSigil.fetch(
      { params: { campaignId, id: created.data.id } },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing sigil", async ({ expect }) => {
    const res = await fetch(
      `${ctx.baseUrl}/sigils/${crypto.randomUUID()}/embed.js`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when the campaign sigils master toggle is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    // Master toggle OFF — the whole embed surface is disabled.
    const campaignId = await createCampaign(ctx, owner, false);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "sigils off", kinds: ["petition"] },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
    );
    expect(res.status).toBe(403);
  });

  it("reflects an allow-listed Origin in CORS headers, denies others", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: {
          label: "cors test",
          allowedOrigins: ["https://shop.example.com"],
        },
      },
      { user: owner },
    );

    const allowed = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
      {
        headers: { origin: "https://shop.example.com" },
      },
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://shop.example.com",
    );
    // Never `*`.
    expect(allowed.headers.get("access-control-allow-origin")).not.toBe("*");

    const denied = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
      {
        headers: { origin: "https://evil.example.com" },
      },
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an OPTIONS preflight for the ingestion surface", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: {
          label: "preflight test",
          allowedOrigins: ["https://shop.example.com"],
        },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
      {
        method: "OPTIONS",
        headers: {
          origin: "https://shop.example.com",
          "access-control-request-method": "GET",
        },
      },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://shop.example.com",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "Content-Type",
    );
  });

  it("emits no Access-Control-Allow-Origin for a sigil with an empty allow-list", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    // No `allowedOrigins` → empty allow-list.
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "no origins" } },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/embed.js`,
      { headers: { origin: "https://shop.example.com" } },
    );
    expect(res.status).toBe(200);
    // The request carries an Origin, but the sigil trusts none → no header.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a missing sigil carries no CORS header", async ({ expect }) => {
    const res = await fetch(
      `${ctx.baseUrl}/sigils/${crypto.randomUUID()}/embed.js`,
      { headers: { origin: "https://shop.example.com" } },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
