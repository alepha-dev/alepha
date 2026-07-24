import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { CharacterInfo } from "../src/api/services/CharacterInfo.ts";

/**
 * `completeQuest` must report what THIS completion awarded, not the
 * character's running totals.
 *
 * MCP `quest_complete` derived `xpEarned` / `moneyEarned` from
 * `result.character.xp` / `.balance` — the lifetime accumulators — under a
 * comment claiming it computed a delta. Agents were told they earned tens
 * of thousands of XP for a single quest.
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
  questController: QuestController;
  characterInfo: CharacterInfo;
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
    questController: alepha.inject(QuestController),
    characterInfo: alepha.inject(CharacterInfo),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fake = ctx.fakeProvider.generate(userDataSchema);
  const r = await ctx.adminUserController.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: r.data.id, roles: r.data.roles };
};

const completeOneQuest = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  campaignId: number,
  difficulty: number,
) => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        title: "Q",
        description: "<p>x</p>",
        zone: "core",
        priority: "medium",
        difficulty,
        campaignId,
        objectives: [],
      },
    },
    { user },
  );
  await ctx.questController.acceptQuest.fetch(
    { params: { id: created.data.id } },
    { user },
  );
  return ctx.questController.completeQuest.fetch(
    { params: { id: created.data.id }, body: {} },
    { user },
  );
};

describe("completeQuest reward reporting", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("reports the per-quest award, not the character's lifetime total", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const campaign = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Rewards" } },
      { user },
    );

    // Bank some XP first so lifetime total and per-quest award diverge.
    await completeOneQuest(ctx, user, campaign.data.id, 5);
    const second = await completeOneQuest(ctx, user, campaign.data.id, 2);

    // difficulty 2, priority medium → 2*150 + 180 = 480 xp; 2*40 + 100 = 180
    expect(second.data.xpEarned).toBe(480);
    expect(second.data.moneyEarned).toBe(180);

    // And it must NOT be the accumulator.
    expect(second.data.xpEarned).not.toBe(second.data.character.xp);
    expect(second.data.moneyEarned).not.toBe(second.data.character.balance);
  });

  it("awards exactly the reported amount to the character", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const campaign = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Rewards" } },
      { user },
    );

    const first = await completeOneQuest(ctx, user, campaign.data.id, 3);
    const xpAfterFirst = first.data.character.xp;
    const second = await completeOneQuest(ctx, user, campaign.data.id, 4);

    expect(second.data.character.xp - xpAfterFirst).toBe(second.data.xpEarned);
  });
});
