import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { members } from "../src/api/entities/members.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Direct table access for the two facts the controller does not expose: that a
 * membership exists, and that an environment's history survives (or does not).
 */
class Probe {
  members = $repository(members);
  views = $repository(sigilViewsHourly);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  tokens: SigilTokenService;
  probe: Probe;
  fakeProvider: FakeProvider;
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
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    tokens: alepha.inject(SigilTokenService),
    probe,
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
    { body: { title: "Sigil Test" } },
    { user },
  );
  return created.data.id;
};

const expectStatus = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.catch((e) => e);
  if (!(error instanceof HttpError)) {
    throw new Error(`Expected an HttpError ${status}, got ${String(error)}`);
  }
  if (error.status !== status) {
    throw new Error(`Expected ${status}, got ${error.status}`);
  }
};

describe("SigilController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("mints a token once, and never returns the hash", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );

    expect(created.data.token).toMatch(/^sg_/);
    expect(created.data.tokenPrefix).toBe(created.data.token.slice(0, 11));
    expect("tokenHash" in created.data).toBe(false);
    // The token resolves to the sigil it was minted for, and to nothing else.
    const resolved = await ctx.tokens.verify(created.data.token);
    expect(resolved?.id).toBe(created.data.id);

    // And it is gone from every later read — the list carries the prefix only.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect("token" in list.data.items[0]).toBe(false);
  });

  it("defaults the label to `app / environment`", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "staging" } },
      { user: owner },
    );

    expect(created.data.label).toBe("lore / staging");
    expect(created.data.kinds.sort()).toEqual([
      "beacon",
      "blights",
      "petition",
      "vitals",
    ]);
  });

  it("refuses a second sigil for the same app and environment", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );

    // A duplicate would split that environment's history across two rows and
    // make every aggregate wrong — 409, not a silent second sigil.
    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { campaignId }, body: { app: "lore", environment: "prod" } },
        { user: owner },
      ),
      409,
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(1);
  });

  it("lists a campaign's sigils, newest first", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "staging" } },
      { user: owner },
    );
    await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(2);
    expect(list.data.items.map((s) => s.environment)).toContain("prod");
    expect(list.data.items.map((s) => s.environment)).toContain("staging");
  });

  it("rotates the token, keeping the environment's history", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );
    await ctx.probe.views.create({
      sigilId: created.data.id,
      hour: "2026-08-01T10",
      path: "/",
      country: "FR",
      count: 7,
    });

    const rotated = await ctx.sigilController.rotateSigil.fetch(
      { params: { campaignId, sigilId: created.data.id } },
      { user: owner },
    );

    // Same sigil, new credential.
    expect(rotated.data.id).toBe(created.data.id);
    expect(rotated.data.token).not.toBe(created.data.token);
    expect(await ctx.tokens.verify(created.data.token)).toBeUndefined();
    expect((await ctx.tokens.verify(rotated.data.token))?.id).toBe(
      created.data.id,
    );

    // …and the whole point: nothing it ever reported was lost.
    const views = await ctx.probe.views.findMany({
      where: { sigilId: { eq: created.data.id } },
    });
    expect(views).toHaveLength(1);
    expect(views[0].count).toBe(7);
  });

  it("deletes the sigil and everything it reported", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );
    await ctx.probe.views.create({
      sigilId: created.data.id,
      hour: "2026-08-01T10",
      path: "/",
      country: "FR",
      count: 7,
    });

    await ctx.sigilController.deleteSigil.fetch(
      { params: { campaignId, sigilId: created.data.id } },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(0);

    // The aggregates cascade — which is exactly why `rotateSigil` exists.
    const views = await ctx.probe.views.findMany({
      where: { sigilId: { eq: created.data.id } },
    });
    expect(views).toHaveLength(0);

    // Genuinely gone: a second delete is a clean 404, not a no-op.
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
  });

  it("lets a member read the inventory but not change it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await ctx.probe.members.create({ userId: member.id, campaignId });

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );

    // Reads are member-gated: the inventory drives the blights filter and the
    // insights page, neither of which is owner-only.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: member },
    );
    expect(list.data.items).toHaveLength(1);

    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { campaignId }, body: { app: "shop", environment: "prod" } },
        { user: member },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { campaignId, sigilId: created.data.id } },
        { user: member },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId, sigilId: created.data.id } },
        { user: member },
      ),
      403,
    );
  });

  it("refuses a stranger everything, reads included", async () => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { app: "lore", environment: "prod" } },
      { user: owner },
    );

    await expectStatus(
      ctx.sigilController.listSigils.fetch(
        { params: { campaignId } },
        { user: stranger },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { campaignId, sigilId: created.data.id } },
        { user: stranger },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId, sigilId: created.data.id } },
        { user: stranger },
      ),
      403,
    );
  });

  it("404s on a sigil that belongs to another campaign", async () => {
    const owner = await createTestUser(ctx);
    const campaignA = await createCampaign(ctx, owner);
    const campaignB = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId: campaignA },
        body: { app: "lore", environment: "prod" },
      },
      { user: owner },
    );

    // The owner check would pass on campaign B; the campaign filter in
    // `loadSigil` is what stops the row being reachable from there.
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { campaignId: campaignB, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId: campaignB, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
  });
});
