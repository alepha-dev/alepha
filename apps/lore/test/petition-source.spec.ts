import { Alepha, t } from "alepha";
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

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
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
    { body: { title: "Petition Source Test" } },
    { user },
  );
  return created.data.id;
};

describe("petition source field", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("accepts a first-party submit with no source (source stays null)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.petitionController.submitPetition.fetch(
      {
        params: { campaignId },
        body: { title: "First-party bug", description: "Something broke" },
      },
      { user: owner },
    );

    const detail = await ctx.petitionController.getPetition.fetch(
      { params: { campaignId, petitionId: created.data.id } },
      { user: owner },
    );
    expect(detail.data.source ?? null).toBeNull();
  });

  it("stores the source block when supplied", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = crypto.randomUUID();

    const created = await ctx.petitionController.submitPetition.fetch(
      {
        params: { campaignId },
        body: {
          title: "Embedded bug",
          description: "From a partner site",
          source: {
            sigilId,
            hostUrl: "https://shop.example.com/checkout",
            hostPath: "/checkout",
            userAgent: "Mozilla/5.0",
            consoleTail: ["TypeError: x is undefined"],
          },
        },
      },
      { user: owner },
    );

    const detail = await ctx.petitionController.getPetition.fetch(
      { params: { campaignId, petitionId: created.data.id } },
      { user: owner },
    );
    expect(detail.data.source?.sigilId).toBe(sigilId);
    expect(detail.data.source?.hostUrl).toBe(
      "https://shop.example.com/checkout",
    );
  });
});
