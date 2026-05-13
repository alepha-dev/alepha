import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
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

describe("CampaignController feature flags", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("defaults all features to true on a new campaign", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Test Campaign" } },
      { user },
    );

    expect(created.data.features).toStrictEqual({
      kanban: true,
      folios: true,
      petitions: true,
      chapters: true,
    });
  });

  it("disables a single feature without dropping the others", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Test Campaign" } },
      { user },
    );

    const updated = await ctx.campaignController.updateCampaignById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: false } },
      },
      { user },
    );

    expect(updated.data.features).toStrictEqual({
      kanban: false,
      folios: true,
      petitions: true,
      chapters: true,
    });
  });

  it("toggles features back on without affecting the others", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Test Campaign" } },
      { user },
    );

    await ctx.campaignController.updateCampaignById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: false, folios: false } },
      },
      { user },
    );

    const updated = await ctx.campaignController.updateCampaignById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: true } },
      },
      { user },
    );

    expect(updated.data.features).toStrictEqual({
      kanban: true,
      folios: false,
      petitions: true,
      chapters: true,
    });
  });

  it("persists feature flags on subsequent reads", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Test Campaign" } },
      { user },
    );

    await ctx.campaignController.updateCampaignById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { petitions: false, chapters: false } },
      },
      { user },
    );

    const fetched = await ctx.campaignController.getCampaignById.fetch(
      { params: { id: created.data.id } },
      { user },
    );

    expect(fetched.data.features).toStrictEqual({
      kanban: true,
      folios: true,
      petitions: false,
      chapters: false,
    });
  });
});
