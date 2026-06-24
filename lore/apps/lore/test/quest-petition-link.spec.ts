import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { PetitionController } from "../src/api/controllers/PetitionController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
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
  questController: QuestController;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    petitionController: alepha.inject(PetitionController),
    questController: alepha.inject(QuestController),
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
    { body: { title: "Link Test" } },
    { user },
  );
  return created.data.id;
};

const submitPetition = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.petitionController.submitPetition.fetch(
    {
      params: { campaignId },
      body: { title: "Reported bug", description: "It broke" },
    },
    { user },
  );
  return created.data.id;
};

const createQuest = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
  petitionId?: number,
): Promise<{ id: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        campaignId,
        title: "Fix the bug",
        description: "Investigate and fix",
        zone: "Bugs",
        priority: "medium",
        difficulty: 2,
        petitionId,
      },
    },
    { user },
  );
  return { id: created.data.id };
};

const linkedQuestIds = async (
  ctx: TestContext,
  campaignId: number,
  petitionId: number,
  user: { id: string; roles: string[] },
): Promise<number[]> => {
  const detail = await ctx.petitionController.getPetition.fetch(
    { params: { campaignId, petitionId } },
    { user },
  );
  return (detail.data.linkedQuests ?? []).map((q) => q.id);
};

describe("quest ↔ petition linking", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("updateQuestById links an existing quest to an accepted petition", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const petitionId = await submitPetition(ctx, campaignId, owner);
    await ctx.petitionController.acceptPetition.fetch(
      { params: { campaignId, petitionId } },
      { user: owner },
    );
    const quest = await createQuest(ctx, campaignId, owner);

    // Not linked yet.
    expect(await linkedQuestIds(ctx, campaignId, petitionId, owner)).toEqual(
      [],
    );

    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { petitionId } },
      { user: owner },
    );

    expect(await linkedQuestIds(ctx, campaignId, petitionId, owner)).toContain(
      quest.id,
    );
  });

  it("updateQuestById sets and clears dependsOn (the picker's save path)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const predecessor = await createQuest(ctx, campaignId, owner);
    const follower = await createQuest(ctx, campaignId, owner);

    // Set the dependency (what the edit-form picker submits).
    const linked = await ctx.questController.updateQuestById.fetch(
      {
        params: { id: follower.id },
        body: { dependsOn: predecessor.id },
      },
      { user: owner },
    );
    expect(linked.data.dependsOn).toBe(predecessor.id);

    // Clear it (the picker's "No dependency" / X path → null).
    const cleared = await ctx.questController.updateQuestById.fetch(
      {
        params: { id: follower.id },
        body: { dependsOn: null },
      },
      { user: owner },
    );
    expect(cleared.data.dependsOn ?? null).toBeNull();
  });

  it("passing petitionId: null unlinks the quest", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const petitionId = await submitPetition(ctx, campaignId, owner);
    await ctx.petitionController.acceptPetition.fetch(
      { params: { campaignId, petitionId } },
      { user: owner },
    );
    // Linked at creation.
    const quest = await createQuest(ctx, campaignId, owner, petitionId);
    expect(await linkedQuestIds(ctx, campaignId, petitionId, owner)).toContain(
      quest.id,
    );

    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { petitionId: null } },
      { user: owner },
    );

    expect(await linkedQuestIds(ctx, campaignId, petitionId, owner)).toEqual(
      [],
    );
  });

  it("rejects linking to a petition that is not accepted", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const petitionId = await submitPetition(ctx, campaignId, owner); // stays pending
    const quest = await createQuest(ctx, campaignId, owner);

    const error = await ctx.questController.updateQuestById
      .fetch(
        { params: { id: quest.id }, body: { petitionId } },
        { user: owner },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });

  it("rejects a non-owner trying to link a quest to a petition", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const petitionId = await submitPetition(ctx, campaignId, owner);
    await ctx.petitionController.acceptPetition.fetch(
      { params: { campaignId, petitionId } },
      { user: owner },
    );
    const quest = await createQuest(ctx, campaignId, owner);

    // An outsider (non-member, non-owner) cannot link the quest — the edit is
    // gated to the quest creator / campaign owner.
    const error = await ctx.questController.updateQuestById
      .fetch(
        { params: { id: quest.id }, body: { petitionId } },
        { user: outsider },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect([403, 404]).toContain((error as HttpError).status);
  });
});
