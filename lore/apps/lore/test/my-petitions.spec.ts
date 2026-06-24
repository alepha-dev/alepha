import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { PetitionController } from "../src/api/controllers/PetitionController.ts";
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
  petitionController: PetitionController;
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

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    petitionController: alepha.inject(PetitionController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

type TestUser = { id: string; roles: string[] };

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createCampaign = async (
  ctx: TestContext,
  user: TestUser,
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Petitions", features: { petitions: true } } },
    { user },
  );
  return created.data.id;
};

const submit = async (
  ctx: TestContext,
  campaignId: number,
  user: TestUser,
  body: { title: string; description: string; tags?: string[] },
): Promise<number> => {
  const res = await ctx.petitionController.submitPetition.fetch(
    { params: { campaignId }, body },
    { user },
  );
  return res.data.id;
};

describe("PetitionController — reporter-scoped /me endpoints", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists only the caller's own petitions", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const other = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    await submit(ctx, campaignId, reporter, {
      title: "Mine 1",
      description: "first",
    });
    await submit(ctx, campaignId, reporter, {
      title: "Mine 2",
      description: "second",
    });
    await submit(ctx, campaignId, other, {
      title: "Theirs",
      description: "not mine",
    });

    const res = await ctx.petitionController.listMyPetitions.fetch(
      { query: {} },
      { user: reporter },
    );

    expect(res.data.content.length).toBe(2);
    const titles = res.data.content.map((p) => p.title).sort();
    expect(titles).toEqual(["Mine 1", "Mine 2"]);
    // Each row carries its owning campaign.
    expect(res.data.content[0].campaign.id).toBe(campaignId);
  });

  it("filters the list by status", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await submit(ctx, campaignId, reporter, { title: "P", description: "d" });

    const pending = await ctx.petitionController.listMyPetitions.fetch(
      { query: { status: "pending" } },
      { user: reporter },
    );
    expect(pending.data.content.length).toBe(1);

    const accepted = await ctx.petitionController.listMyPetitions.fetch(
      { query: { status: "accepted" } },
      { user: reporter },
    );
    expect(accepted.data.content.length).toBe(0);
  });

  it("edits a pending petition (title, description, tags)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const id = await submit(ctx, campaignId, reporter, {
      title: "Old",
      description: "old body",
    });

    const updated = await ctx.petitionController.updateMyPetition.fetch(
      {
        params: { petitionId: id },
        body: { title: "New", description: "new body", tags: ["bug"] },
      },
      { user: reporter },
    );

    expect(updated.data.title).toBe("New");
    expect(updated.data.description).toBe("new body");
    expect(updated.data.tags).toEqual(["bug"]);
  });

  it("rejects editing a petition the caller does not own (404)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const intruder = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const id = await submit(ctx, campaignId, reporter, {
      title: "Mine",
      description: "d",
    });

    await expect(
      ctx.petitionController.updateMyPetition.fetch(
        {
          params: { petitionId: id },
          body: { title: "hijack", description: "hijack" },
        },
        { user: intruder },
      ),
    ).rejects.toThrow();
  });

  it("soft-deletes a pending petition so it leaves the list", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const id = await submit(ctx, campaignId, reporter, {
      title: "Bye",
      description: "d",
    });

    await ctx.petitionController.deleteMyPetition.fetch(
      { params: { petitionId: id } },
      { user: reporter },
    );

    const res = await ctx.petitionController.listMyPetitions.fetch(
      { query: {} },
      { user: reporter },
    );
    expect(res.data.content.length).toBe(0);
  });

  it("lists the distinct campaigns the caller has petitions in", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    await submit(ctx, campaignId, reporter, { title: "A", description: "d" });
    await submit(ctx, campaignId, reporter, { title: "B", description: "d" });

    const res = await ctx.petitionController.listMyPetitionCampaigns.fetch(
      {},
      { user: reporter },
    );
    expect(res.data.items.length).toBe(1);
    expect(res.data.items[0].id).toBe(campaignId);
  });
});
