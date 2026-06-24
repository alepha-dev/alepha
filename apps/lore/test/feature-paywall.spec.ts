import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { FeaturePaywallController } from "../src/api/controllers/FeaturePaywallController.ts";
import type { Character } from "../src/api/entities/characters.ts";
import { LoreApi } from "../src/api/index.ts";
import { FeaturePaywallService } from "../src/api/services/FeaturePaywallService.ts";
import { FeatureRegistry } from "../src/api/services/FeatureRegistry.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  paywallController: FeaturePaywallController;
  paywall: FeaturePaywallService;
  registry: FeatureRegistry;
  fakeProvider: FakeProvider;
  // biome-ignore lint/suspicious/noExplicitAny: ORM Repository generic is too strict
  charactersRepo: any;
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
    paywallController: alepha.inject(FeaturePaywallController),
    paywall: alepha.inject(FeaturePaywallService),
    registry: alepha.inject(FeatureRegistry),
    fakeProvider: alepha.inject(FakeProvider),
    charactersRepo: (
      alepha.inject(CampaignController) as unknown as {
        characters: {
          findMany: (q: unknown) => Promise<Character[]>;
          save: (c: Character) => Promise<Character>;
        };
      }
    ).characters,
  };
};

async function createTestUser(ctx: TestContext) {
  const fake = ctx.fakeProvider.generate(userDataSchema);
  const r = await ctx.adminUserController.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: r.data.id, roles: r.data.roles };
}

async function createCampaignWithFundedOwner(
  ctx: TestContext,
  balance: number,
) {
  const user = await createTestUser(ctx);
  const campaign = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Paywall" } },
    { user },
  );
  const chars = (await ctx.charactersRepo.findMany({
    where: { campaignId: { eq: campaign.data.id } },
  })) as Character[];
  const owner = chars[0];
  owner.balance = balance;
  await ctx.charactersRepo.save(owner);
  return { user, campaign: campaign.data, owner };
}

describe("FeaturePaywallService", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rejects unknown feature keys", async () => {
    const { campaign, owner } = await createCampaignWithFundedOwner(
      ctx,
      1_000_000,
    );
    await expect(
      ctx.paywall.buy(campaign.id, owner, "made_up_feature"),
    ).rejects.toThrow(/Unknown feature/);
  });

  it("rejects when the character's balance is too low", async () => {
    const { campaign, owner } = await createCampaignWithFundedOwner(ctx, 50);
    // Every Shop feature costs 1g = 100 silver-ledger; balance=50 is short.
    await expect(
      ctx.paywall.buy(campaign.id, owner, "chronicles"),
    ).rejects.toThrow(/Insufficient balance/);
  });

  it("debits balance and records unlock + history on success", async () => {
    const { campaign, owner } = await createCampaignWithFundedOwner(
      ctx,
      1 * 100,
    );
    const result = await ctx.paywall.buy(campaign.id, owner, "chronicles");
    expect(result.character.balance).toBe(0);
    expect(result.campaign.unlockedFeatures).toContain("chronicles");
    expect(result.campaign.unlockHistory).toHaveLength(1);
    expect(result.campaign.unlockHistory[0]).toMatchObject({
      feature: "chronicles",
      characterId: owner.id,
      price: 1,
    });
  });

  it("refuses to double-unlock a feature already on", async () => {
    const { campaign, owner } = await createCampaignWithFundedOwner(
      ctx,
      10 * 100,
    );
    await ctx.paywall.buy(campaign.id, owner, "chronicles");
    // First buy succeeds; second attempt is blocked by the
    // already-unlocked check, NOT insufficient balance.
    await expect(
      ctx.paywall.buy(campaign.id, owner, "chronicles"),
    ).rejects.toThrow(/already unlocked/);
  });

  it("rejects a character from a different campaign", async () => {
    const { campaign: c1, owner: o1 } = await createCampaignWithFundedOwner(
      ctx,
      10 * 100,
    );
    const { campaign: c2 } = await createCampaignWithFundedOwner(ctx, 10 * 100);
    expect(c1.id).not.toBe(c2.id);
    await expect(ctx.paywall.buy(c2.id, o1, "chronicles")).rejects.toThrow(
      /does not belong/,
    );
  });

  it("registry exposes exactly the starter three", () => {
    const keys = ctx.registry.list().map((f) => f.key);
    expect(keys).toStrictEqual([
      "quest_reminder",
      "chronicles",
      "quest_gating",
    ]);
  });
});
