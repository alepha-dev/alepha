import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";

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

  await alepha.start();

  return {
    alepha,
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
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Sigil Test Campaign" } },
    { user },
  );
  return created.data.id;
};

describe("SigilController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates a sigil with a uuid id, never exposing ingestKey", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { campaignId },
        body: { label: "shop.example.com checkout" },
      },
      { user: owner },
    );

    expect(created.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.data.label).toBe("shop.example.com checkout");
    // ingestKey is a vestigial internal column — never in the resource.
    expect("ingestKey" in created.data).toBe(false);
  });

  it("lists sigils for the campaign, newest first, without ingestKey", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "First" } },
      { user: owner },
    );
    await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "Second" } },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );

    expect(list.data.items).toHaveLength(2);
    expect(list.data.items[0].label).toBe("Second");
    expect(list.data.items[1].label).toBe("First");
    for (const item of list.data.items) {
      expect("ingestKey" in item).toBe(false);
    }
  });

  it("hard-deletes a sigil — the row is genuinely gone", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "Delete me" } },
      { user: owner },
    );

    await ctx.sigilController.deleteSigil.fetch(
      { params: { campaignId, id: created.data.id } },
      { user: owner },
    );

    // The row is hard-deleted — a follow-up list does not return it.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(
      list.data.items.find((s) => s.id === created.data.id),
    ).toBeUndefined();

    // Deleting a now-missing sigil 404s (it is genuinely gone).
    const error = await ctx.sigilController.deleteSigil
      .fetch({ params: { campaignId, id: created.data.id } }, { user: owner })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it("renames a sigil (label), keeping the id stable", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "Before" } },
      { user: owner },
    );

    const updated = await ctx.sigilController.updateSigil.fetch(
      {
        params: { campaignId, id: created.data.id },
        body: { label: "After" },
      },
      { user: owner },
    );

    // id is the immutable public credential — never changes on update.
    expect(updated.data.id).toBe(created.data.id);
    expect(updated.data.label).toBe("After");
    // ingestKey is a secret — never returned, never mutated by update.
    expect("ingestKey" in updated.data).toBe(false);

    // The change persisted.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    const row = list.data.items.find((s) => s.id === created.data.id);
    expect(row?.label).toBe("After");
  });

  it("rejects a non-owner from update and delete (403)", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "Owned" } },
      { user: owner },
    );

    const expectForbidden = async (promise: Promise<unknown>) => {
      const error = await promise.catch((e) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    };

    await expectForbidden(
      ctx.sigilController.updateSigil.fetch(
        {
          params: { campaignId, id: created.data.id },
          body: { label: "Hijacked" },
        },
        { user: stranger },
      ),
    );

    await expectForbidden(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId, id: created.data.id } },
        { user: stranger },
      ),
    );
  });

  it("404s when updating a sigil from a different campaign", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignA = await createCampaign(ctx, owner);
    const campaignB = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId: campaignA }, body: { label: "In A" } },
      { user: owner },
    );

    const error = await ctx.sigilController.updateSigil
      .fetch(
        {
          params: { campaignId: campaignB, id: created.data.id },
          body: { label: "Wrong campaign" },
        },
        { user: owner },
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it("rejects a non-owner from every endpoint (403)", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId }, body: { label: "Owned" } },
      { user: owner },
    );

    // Each owner-gated endpoint must reject a non-owner with a 403.
    const expectForbidden = async (promise: Promise<unknown>) => {
      const error = await promise.catch((e) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    };

    await expectForbidden(
      ctx.sigilController.createSigil.fetch(
        { params: { campaignId }, body: { label: "Intruder" } },
        { user: stranger },
      ),
    );

    await expectForbidden(
      ctx.sigilController.listSigils.fetch(
        { params: { campaignId } },
        { user: stranger },
      ),
    );

    await expectForbidden(
      ctx.sigilController.deleteSigil.fetch(
        { params: { campaignId, id: created.data.id } },
        { user: stranger },
      ),
    );
  });

  it("404s when the sigil belongs to a different campaign", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignA = await createCampaign(ctx, owner);
    const campaignB = await createCampaign(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { campaignId: campaignA }, body: { label: "In A" } },
      { user: owner },
    );

    const error = await ctx.sigilController.deleteSigil
      .fetch(
        { params: { campaignId: campaignB, id: created.data.id } },
        { user: owner },
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });
});
