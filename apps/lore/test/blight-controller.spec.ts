import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { afterEach, beforeEach, describe, it } from "vitest";
import { BlightController } from "../src/api/controllers/BlightController.ts";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";
import { BlightIngestService } from "../src/api/services/BlightIngestService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  questController: QuestController;
  blightController: BlightController;
  blights: BlightIngestService;
  fakeProvider: FakeProvider;
}

const ORIGIN = "https://shop.example.com";

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
  alepha.with(AlephaServerCors);
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
    sigilController: alepha.inject(SigilController),
    questController: alepha.inject(QuestController),
    blightController: alepha.inject(BlightController),
    blights: alepha.inject(BlightIngestService),
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
    { body: { title: "Blights", features: { blights: true } } },
    { user },
  );
  return created.data.id;
};

const createSigil = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: {
        label: "blight sigil",
        kinds: ["blights"],
      },
    },
    { user },
  );
  return created.data.id;
};

const ev = (over: Record<string, string> = {}) => ({
  name: "TypeError",
  message: "x is not a function",
  stack:
    "TypeError: x is not a function\n  at foo (https://shop.example.com/app.js:1:1)",
  sourceUrl: "https://shop.example.com/page",
  ...over,
});

/**
 * Seed `n` distinct blights (distinct fingerprints) on a sigil, each
 * ingested `counts[i]` times so `count` differs row-to-row.
 */
const seedBlights = async (
  ctx: TestContext,
  sigilId: string,
  counts: number[],
): Promise<void> => {
  for (let i = 0; i < counts.length; i++) {
    const event = ev({
      message: `crash ${i}`,
      stack: `Error: c${i}\n  at f${i} (a.js:1:1)`,
    });
    for (let k = 0; k < counts[i]; k++) {
      await ctx.blights.ingestEvent(sigilId, event, `203.0.113.${i}`);
    }
  }
};

describe("BlightController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists open blights sorted by count desc", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [1, 5, 3]);

    const res = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    expect(res.data.items.map((b) => b.count)).toEqual([5, 3, 1]);
    expect(res.data.openCount).toBe(3);
  });

  it("hides resolved blights by default, shows them with includeResolved", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [4, 2]);

    const open = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    const target = open.data.items[0];

    await ctx.blightController.resolveBlight.fetch(
      { params: { campaignId, blightId: target.id } },
      { user: owner },
    );

    const defaultView = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    expect(
      defaultView.data.items.find((b) => b.id === target.id),
    ).toBeUndefined();
    expect(defaultView.data.openCount).toBe(1);

    const withResolved = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: { includeResolved: true } },
      { user: owner },
    );
    const resolved = withResolved.data.items.find((b) => b.id === target.id);
    expect(resolved?.status).toBe("resolved");
  });

  it("countOpenBlights returns the open count", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [1, 1, 1]);

    const before = await ctx.blightController.countOpenBlights.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(before.data.count).toBe(3);

    const list = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    await ctx.blightController.resolveBlight.fetch(
      { params: { campaignId, blightId: list.data.items[0].id } },
      { user: owner },
    );

    const after = await ctx.blightController.countOpenBlights.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(after.data.count).toBe(2);
  });

  it("forward-to-quest creates a quest linked to the blight and flips status", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [7]);

    const list = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    const blight = list.data.items[0];

    const res = await ctx.blightController.forwardBlightToQuest.fetch(
      { params: { campaignId, blightId: blight.id } },
      { user: owner },
    );
    expect(res.data.questId).toBeGreaterThan(0);

    // The quest carries source.sigilBlightId.
    const quest = await ctx.questController.getQuestById.fetch(
      { params: { id: res.data.questId } },
      { user: owner },
    );
    expect(quest.data.source?.sigilBlightId).toBe(blight.id);
    expect(quest.data.title.startsWith("[Blight]")).toBe(true);
    // Spread summary present in the description.
    expect(quest.data.description).toContain("Affected 7 sessions");

    // The blight flips to quest:<id>.
    const after = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: { includeResolved: true } },
      { user: owner },
    );
    const updated = after.data.items.find((b) => b.id === blight.id);
    expect(updated?.status).toBe(`quest:${res.data.questId}`);

    // Forwarding twice is rejected.
    await expect(
      ctx.blightController.forwardBlightToQuest.fetch(
        { params: { campaignId, blightId: blight.id } },
        { user: owner },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deletes a blight row", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [3]);

    const list = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    const blight = list.data.items[0];

    await ctx.blightController.deleteBlight.fetch(
      { params: { campaignId, blightId: blight.id } },
      { user: owner },
    );

    const after = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: { includeResolved: true } },
      { user: owner },
    );
    expect(after.data.items).toHaveLength(0);
  });

  it("listBlights returns the campaign sigils for the filter dropdown", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    expect(res.data.sigils).toHaveLength(1);
    expect(res.data.sigils[0].id).toBe(sigilId);
    expect(res.data.sigils[0].label).toBe("blight sigil");
  });

  it("mass-deletes selected blights and ignores stray ids", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [1, 2, 3]);

    const list = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    const ids = list.data.items.map((b) => b.id);

    // Delete two of three, plus a stray id that belongs to no campaign sigil —
    // the stray is silently skipped (the sigilId filter is the guard).
    const res = await ctx.blightController.deleteBlights.fetch(
      { params: { campaignId }, body: { ids: [ids[0], ids[1], 999_999] } },
      { user: owner },
    );
    expect(res.data.deleted).toBe(2);

    const after = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: { includeResolved: true } },
      { user: owner },
    );
    expect(after.data.items.map((b) => b.id)).toEqual([ids[2]]);
  });

  it("creates, lists, and deletes blight ignore rules", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    const created = await ctx.blightController.createBlightRule.fetch(
      { params: { campaignId }, body: { pattern: "  Unknown club  " } },
      { user: owner },
    );
    // Pattern is trimmed.
    expect(created.data.pattern).toBe("Unknown club");

    const list = await ctx.blightController.listBlightRules.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(list.data.items.map((r) => r.pattern)).toEqual(["Unknown club"]);

    await ctx.blightController.deleteBlightRule.fetch(
      { params: { campaignId, ruleId: created.data.id } },
      { user: owner },
    );

    const after = await ctx.blightController.listBlightRules.fetch(
      { params: { campaignId } },
      { user: owner },
    );
    expect(after.data.items).toHaveLength(0);

    // Deleting a now-missing rule 404s.
    await expect(
      ctx.blightController.deleteBlightRule.fetch(
        { params: { campaignId, ruleId: created.data.id } },
        { user: owner },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rule mutations are owner-only", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    await expect(
      ctx.blightController.createBlightRule.fetch(
        { params: { campaignId }, body: { pattern: "x" } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("non-owner gets 403 on every endpoint", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);
    await seedBlights(ctx, sigilId, [2]);

    const list = await ctx.blightController.listBlights.fetch(
      { params: { campaignId }, query: {} },
      { user: owner },
    );
    const blightId = list.data.items[0].id;

    await expect(
      ctx.blightController.listBlights.fetch(
        { params: { campaignId }, query: {} },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      ctx.blightController.countOpenBlights.fetch(
        { params: { campaignId } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      ctx.blightController.resolveBlight.fetch(
        { params: { campaignId, blightId } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      ctx.blightController.forwardBlightToQuest.fetch(
        { params: { campaignId, blightId } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      ctx.blightController.deleteBlight.fetch(
        { params: { campaignId, blightId } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      ctx.blightController.deleteBlights.fetch(
        { params: { campaignId }, body: { ids: [blightId] } },
        { user: stranger },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
