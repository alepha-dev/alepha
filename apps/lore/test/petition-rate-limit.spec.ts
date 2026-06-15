import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm, RepositoryProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { PetitionController } from "../src/api/controllers/PetitionController.ts";
import { characters } from "../src/api/entities/characters.ts";
import { LoreApi } from "../src/api/index.ts";
import { PetitionRateLimiter } from "../src/api/services/PetitionRateLimiter.ts";

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
    { body: { title: "Rate Limit Test" } },
    { user },
  );
  return created.data.id;
};

const submit = (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
  n: number,
) =>
  ctx.petitionController.submitPetition.fetch(
    {
      params: { campaignId },
      body: { title: `Bug ${n}`, description: "Something broke" },
    },
    { user },
  );

describe("petition rate limit", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rate-limits a non-member past the daily cap with a clean 429 message", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const limit = ctx.alepha
      .inject(PetitionRateLimiter)
      .options().maxPetitionsPerUserPerDay;

    // Up to the cap is allowed.
    for (let i = 0; i < limit; i++) {
      await submit(ctx, campaignId, outsider, i);
    }

    // One past the cap: a clean 429 (not an opaque 500), with the real message.
    const error = await submit(ctx, campaignId, outsider, limit).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect((error as HttpError).message).toMatch(/rate limit/i);
  });

  it("exempts the campaign owner from the petition rate limit", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const limit = ctx.alepha
      .inject(PetitionRateLimiter)
      .options().maxPetitionsPerUserPerDay;

    // Well beyond the cap — every submit must succeed for the owner.
    for (let i = 0; i < limit + 2; i++) {
      const res = await submit(ctx, campaignId, owner, i);
      expect(res.data.id).toBeGreaterThan(0);
    }
  });

  it("exempts a joined member (character row) from the petition rate limit", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    // Make `member` a real campaign member (non-owner character row).
    const charactersRepo = ctx.alepha
      .inject(RepositoryProvider)
      .getRepository(characters);
    await charactersRepo.create({
      userId: member.id,
      campaignId,
      xp: 0,
      owner: false,
    });

    const limit = ctx.alepha
      .inject(PetitionRateLimiter)
      .options().maxPetitionsPerUserPerDay;

    for (let i = 0; i < limit + 2; i++) {
      const res = await submit(ctx, campaignId, member, i);
      expect(res.data.id).toBeGreaterThan(0);
    }
  });
});
