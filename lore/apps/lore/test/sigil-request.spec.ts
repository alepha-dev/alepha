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
  features: { sigils?: boolean; embeddedPetitions?: boolean } = {
    sigils: true,
    embeddedPetitions: true,
  },
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Sigil Request", features } },
    { user },
  );
  return created.data.id;
};

describe("Sigil petition request route", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("redirects a live petition-kind sigil to the campaign request form", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "shop", kinds: ["petition"] },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/request?path=%2Fcheckout&url=https%3A%2F%2Fshop.example.com%2Fcheckout&type=bug`,
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`/c/${campaignId}/request`);
    // The sigil id rides along so the SPA can populate `source.sigilId`.
    expect(location).toContain(`sigil=${created.data.id}`);
    // Query params from the embed launcher are forwarded.
    expect(location).toContain("type=bug");
    expect(location).toContain("path=");
    expect(location).toContain("url=");
  });

  it("returns 404 for a missing sigil", async ({ expect }) => {
    const res = await fetch(
      `${ctx.baseUrl}/sigils/${crypto.randomUUID()}/request`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a deleted sigil", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "delete me", kinds: ["petition"] },
      },
      { user: owner },
    );
    // Sigils are hard-deleted — a deleted sigil is just a 404, no 410.
    await ctx.sigilController.deleteSigil.fetch(
      { params: { campaignId, id: created.data.id } },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/request`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for a sigil without the petition kind", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "blights only", kinds: ["blights"] },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/request`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when the campaign embeddedPetitions feature is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    // sigils master ON, but the embeddedPetitions capability toggle OFF.
    const campaignId = await createCampaign(ctx, owner, {
      sigils: true,
      embeddedPetitions: false,
    });

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "petitions off", kinds: ["petition"] },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/request`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when the campaign sigils master toggle is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    // embeddedPetitions ON, but the sigils master toggle OFF.
    const campaignId = await createCampaign(ctx, owner, {
      sigils: false,
      embeddedPetitions: true,
    });

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "sigils off", kinds: ["petition"] },
      },
      { user: owner },
    );

    const res = await fetch(
      `${ctx.baseUrl}/sigils/${created.data.id}/request`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
  });
});
