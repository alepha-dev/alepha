import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  campaigns: CampaignController;
  folios: FolioController;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
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
    admin: alepha.inject(AdminUserController),
    campaigns: alepha.inject(CampaignController),
    folios: alepha.inject(FolioController),
    fake: alepha.inject(FakeProvider),
  };
};

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return {
    id: response.data.id,
    roles: response.data.roles,
    username: fake.username,
  };
};

describe("FolioController.listCampaignActivity", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns recent revisions newest-first, includes author username", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const campaign = await ctx.campaigns.createCampaign.fetch(
      { body: { title: "Activity probe" } },
      { user: owner },
    );
    const cid = campaign.data.id;

    const a = await ctx.folios.create.fetch(
      { body: { campaignId: cid, title: "A", content: "" } },
      { user: owner },
    );
    // Edit to push a second revision.
    await ctx.folios.update.fetch(
      { params: { id: a.data.id }, body: { content: "first edit" } },
      { user: owner },
    );
    await ctx.folios.create.fetch(
      { body: { campaignId: cid, title: "B", content: "" } },
      { user: owner },
    );

    const feed = await ctx.folios.listCampaignActivity.fetch(
      { query: { campaignId: cid } },
      { user: owner },
    );

    // 3 revisions: A.create, A.edit, B.create — newest first.
    expect(feed.data.items.map((i) => i.action)).toEqual([
      "create",
      "edit",
      "create",
    ]);
    expect(feed.data.items[0].folioTitle).toBe("B");
    expect(feed.data.items[2].folioTitle).toBe("A");
    expect(feed.data.items.every((i) => i.byUsername === owner.username)).toBe(
      true,
    );
  });

  it("honors limit (caps to the most recent N)", async ({ expect }) => {
    const owner = await createUser(ctx);
    const campaign = await ctx.campaigns.createCampaign.fetch(
      { body: { title: "Limit probe" } },
      { user: owner },
    );
    const cid = campaign.data.id;
    for (let i = 0; i < 5; i++) {
      await ctx.folios.create.fetch(
        { body: { campaignId: cid, title: `F${i}`, content: "" } },
        { user: owner },
      );
    }

    const feed = await ctx.folios.listCampaignActivity.fetch(
      { query: { campaignId: cid, limit: 3 } },
      { user: owner },
    );
    expect(feed.data.items).toHaveLength(3);
    // 3 most-recent creates — F4, F3, F2.
    expect(feed.data.items.map((i) => i.folioTitle)).toEqual([
      "F4",
      "F3",
      "F2",
    ]);
  });

  it("rejects non-members with 403", async ({ expect }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const campaign = await ctx.campaigns.createCampaign.fetch(
      { body: { title: "Members only" } },
      { user: owner },
    );
    await ctx.folios.create.fetch(
      { body: { campaignId: campaign.data.id, title: "Hidden", content: "" } },
      { user: owner },
    );
    await expect(
      ctx.folios.listCampaignActivity.fetch(
        { query: { campaignId: campaign.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("returns empty array when the campaign has no folios", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const campaign = await ctx.campaigns.createCampaign.fetch(
      { body: { title: "Empty campaign" } },
      { user: owner },
    );
    const feed = await ctx.folios.listCampaignActivity.fetch(
      { query: { campaignId: campaign.data.id } },
      { user: owner },
    );
    expect(feed.data.items).toEqual([]);
  });
});
