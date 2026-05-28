import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import type { Character } from "../src/api/entities/characters.ts";
import { LoreApi } from "../src/api/index.ts";
import { AchievementEngine } from "../src/api/services/AchievementEngine.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  questController: QuestController;
  engine: AchievementEngine;
  fakeProvider: FakeProvider;
  // biome-ignore lint/suspicious/noExplicitAny: ORM Repository generic is too strict to thread through here
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
    questController: alepha.inject(QuestController),
    engine: alepha.inject(AchievementEngine),
    fakeProvider: alepha.inject(FakeProvider),
    charactersRepo: (
      alepha.inject(CampaignController) as unknown as {
        characters: { findMany: (q: unknown) => Promise<Character[]> };
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

async function createCampaign(
  ctx: TestContext,
  user: { id: string; roles: string[] },
) {
  const r = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Achievement Probe" } },
    { user },
  );
  return r.data;
}

async function completeOneQuest(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  campaignId: number,
) {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        title: "Q",
        description: "<p>x</p>",
        zone: "core",
        priority: "medium",
        difficulty: 3,
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
  await ctx.questController.completeQuest.fetch(
    { params: { id: created.data.id }, body: {} },
    { user },
  );
}

describe("AchievementEngine", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("registry", () => {
    it("exposes exactly two starter achievements with icons", () => {
      const catalog = ctx.engine.list();
      expect(catalog).toHaveLength(2);
      const byKey = Object.fromEntries(catalog.map((a) => [a.key, a]));
      expect(byKey.hard_worker).toMatchObject({
        label: "Hard Worker",
        icon: "Award",
      });
      expect(byKey.bookkeeper).toMatchObject({
        label: "Bookkeeper",
        icon: "BookOpen",
      });
    });
  });

  describe("grant", () => {
    it("appends new keys and de-duplicates", () => {
      const character = { achievements: ["hard_worker"] } as Character;
      const next = ctx.engine.grant(character, ["hard_worker", "bookkeeper"]);
      expect(next).toStrictEqual(["hard_worker", "bookkeeper"]);
    });

    it("is a no-op for an empty key list", () => {
      const character = { achievements: ["foo"] } as Character;
      const next = ctx.engine.grant(character, []);
      expect(next).toStrictEqual(["foo"]);
    });
  });

  describe("hard_worker", () => {
    it("is granted on the 10th completed quest, not before", async () => {
      const user = await createTestUser(ctx);
      const campaign = await createCampaign(ctx, user);

      for (let i = 0; i < 9; i++) {
        await completeOneQuest(ctx, user, campaign.id);
      }
      let chars = (await ctx.charactersRepo.findMany({
        where: { campaignId: { eq: campaign.id } },
      })) as Character[];
      expect(chars[0]?.achievements ?? []).not.toContain("hard_worker");

      await completeOneQuest(ctx, user, campaign.id);
      chars = (await ctx.charactersRepo.findMany({
        where: { campaignId: { eq: campaign.id } },
      })) as Character[];
      expect(chars[0]?.achievements ?? []).toContain("hard_worker");
    });

    it("does not duplicate after further completions", async () => {
      const user = await createTestUser(ctx);
      const campaign = await createCampaign(ctx, user);
      for (let i = 0; i < 11; i++) {
        await completeOneQuest(ctx, user, campaign.id);
      }
      const chars = (await ctx.charactersRepo.findMany({
        where: { campaignId: { eq: campaign.id } },
      })) as Character[];
      const count = (chars[0]?.achievements ?? []).filter(
        (k) => k === "hard_worker",
      ).length;
      expect(count).toBe(1);
    });
  });
});
