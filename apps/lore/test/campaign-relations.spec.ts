import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Regression guards for the reads that moved onto `$relations`.
 *
 * Each one used to fetch a table, map out ids, and fetch a second table with
 * `inArray`. That shape carried a silent guarantee — `inArray` de-duplicates —
 * which a relation does not. Here that guarantee comes from a unique index
 * instead, so the index is pinned alongside the endpoints that now lean on it.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  fakeProvider: FakeProvider;
}

class MemberProbe {
  repository = $repository(members);
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

  alepha.inject(MemberProbe);
  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
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

describe("CampaignController reads through relations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * The invariant the `members` and `campaigns` relations rest on.
   *
   * Both hop through `characters`. If a user could hold two characters in one
   * campaign, both relations would start returning duplicates — the campaign
   * twice on the home page, the member twice in the roster — and nothing in
   * the response schemas would catch it. Remove this index and those two
   * endpoints regress silently, so it is pinned here rather than left to the
   * migration that created it.
   */
  it("allows only one membership per user per campaign", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "One membership each" } },
      { user: owner },
    );

    const repository = ctx.alepha.inject(MemberProbe).repository;

    // The owner already holds one from campaign creation.
    const existing = await repository.findMany({
      where: { campaignId: { eq: created.data.id } },
    });
    expect(existing).toHaveLength(1);

    await expect(
      repository.create({
        userId: owner.id,
        campaignId: created.data.id,
      }),
    ).rejects.toThrow();
  });

  it("getCampaignUsers returns every member exactly once", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);

    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Two members" } },
      { user: owner },
    );

    const repository = ctx.alepha.inject(MemberProbe).repository;
    await repository.create({
      userId: member.id,
      campaignId: created.data.id,
    });

    const response = await ctx.campaignController.getCampaignUsers.fetch(
      { params: { id: created.data.id } },
      { user: owner },
    );

    const ids = response.data.map((u) => u.id).sort();
    expect(ids).toEqual([owner.id, member.id].sort());
  });

  it("getCampaignUsers is empty for a campaign with no members", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Solo" } },
      { user: owner },
    );

    const repository = ctx.alepha.inject(MemberProbe).repository;
    const existing = await repository.findMany({
      where: { campaignId: { eq: created.data.id } },
    });
    for (const member of existing) {
      await repository.deleteById(member.id);
    }

    const response = await ctx.campaignController.getCampaignUsers.fetch(
      { params: { id: created.data.id } },
      { user: owner },
    );

    expect(response.data).toEqual([]);
  });

  it("getHomeOverview lists the user's campaigns, newest first", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);

    const first = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "First" } },
      { user: owner },
    );
    const second = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Second" } },
      { user: owner },
    );

    const response = await ctx.campaignController.getHomeOverview.fetch(
      {},
      { user: owner },
    );

    expect(response.data.totalCount).toBe(2);
    expect(response.data.ownedCount).toBe(2);
    expect(response.data.campaigns.map((c) => c.id).sort()).toEqual(
      [first.data.id, second.data.id].sort(),
    );
  });

  it("getHomeOverview shows nothing to a user with no campaigns", async ({
    expect,
  }) => {
    const stranger = await createTestUser(ctx);

    const response = await ctx.campaignController.getHomeOverview.fetch(
      {},
      { user: stranger },
    );

    expect(response.data.campaigns).toEqual([]);
    expect(response.data.totalCount).toBe(0);
    expect(response.data.ownedCount).toBe(0);
    expect(response.data.canCreate).toBe(true);
  });

  /**
   * A member sees the campaign they joined, and only that one — the relation
   * hops through their own character, so someone else's campaign must not
   * come back with it.
   */
  it("getMyCampaigns shows a member their campaign and no other", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);

    const joined = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Joined" } },
      { user: owner },
    );
    await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Not joined" } },
      { user: owner },
    );

    await ctx.alepha.inject(MemberProbe).repository.create({
      userId: member.id,
      campaignId: joined.data.id,
    });

    const response = await ctx.campaignController.getMyCampaigns.fetch(
      { query: {} },
      { user: member },
    );

    expect(response.data.map((c) => c.title)).toEqual(["Joined"]);
  });
});
