import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm, RepositoryProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BeaconController } from "../src/api/controllers/BeaconController.ts";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { beacons } from "../src/api/entities/beacons.ts";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { quests } from "../src/api/entities/quests.ts";
import { RoadmapApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  beaconController: BeaconController;
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
  alepha.with(RoadmapApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    beaconController: alepha.inject(BeaconController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
  roles: string[] = ["user"],
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createTestCampaign = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  withBeacons = true,
) => {
  const response = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Test Campaign" } },
    { user },
  );
  const campaignId = response.data.id;

  if (withBeacons) {
    const repo = ctx.alepha.inject(RepositoryProvider).getRepository(campaigns);
    await repo.updateById(campaignId, {
      beacons: {
        enabled: true,
        publicToken: "pk_initial_token_1234567890abcdef",
        allowedOrigins: ["example.com"],
      },
    });
  }

  return campaignId;
};

const seedBeacon = async (
  ctx: TestContext,
  campaignId: number,
  overrides: Partial<{
    status: "new" | "promoted" | "discarded";
    title: string;
    reportType: "bug" | "feature";
  }> = {},
) => {
  const repo = ctx.alepha.inject(RepositoryProvider).getRepository(beacons);
  return repo.create({
    campaignId,
    title: overrides.title ?? "Login button broken",
    description: "Clicking does nothing on Safari",
    reportType: overrides.reportType ?? "bug",
    status: overrides.status ?? "new",
    context: {
      url: "https://example.com/login",
      path: "/login",
      userAgent: "Mozilla/5.0",
      viewport: { width: 1280, height: 800 },
    },
    ipHash: "a".repeat(64),
  });
};

describe("BeaconController (owner endpoints)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("promote", () => {
    it("creates a quest with the right field mapping and links the beacon", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user);
      const beacon = await seedBeacon(ctx, campaignId);

      const res = await ctx.beaconController.promote.fetch(
        {
          params: { campaignId, beaconId: beacon.id },
          body: {
            title: "Fix Safari login",
            description: "Clicking does nothing on Safari",
            zone: "frontend",
            priority: "high",
            difficulty: 3,
          },
        },
        { user },
      );

      expect(res.data.questId).toBeGreaterThan(0);

      const questRepo = ctx.alepha
        .inject(RepositoryProvider)
        .getRepository(quests);
      const quest = await questRepo.findById(res.data.questId);
      expect(quest?.title).toBe("Fix Safari login");
      expect(quest?.priority).toBe("high");
      expect(quest?.difficulty).toBe(3);
      expect(quest?.zone).toBe("frontend");
      expect(quest?.campaignId).toBe(campaignId);
      expect(quest?.createdBy).toBe(user.id);

      const beaconRepo = ctx.alepha
        .inject(RepositoryProvider)
        .getRepository(beacons);
      const updated = await beaconRepo.findById(beacon.id);
      expect(updated?.status).toBe("promoted");
      expect(updated?.promotedQuestId).toBe(res.data.questId);
    });

    it("rejects promotion of an already-triaged beacon", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user);
      const beacon = await seedBeacon(ctx, campaignId, { status: "discarded" });

      await expect(
        ctx.beaconController.promote.fetch(
          {
            params: { campaignId, beaconId: beacon.id },
            body: {
              title: "T",
              description: "D",
              zone: "z",
              priority: "low",
              difficulty: 1,
            },
          },
          { user },
        ),
      ).rejects.toThrow(/already triaged/i);
    });

    it("forbids non-owner users from promoting", async () => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, owner);
      const beacon = await seedBeacon(ctx, campaignId);

      await expect(
        ctx.beaconController.promote.fetch(
          {
            params: { campaignId, beaconId: beacon.id },
            body: {
              title: "T",
              description: "D",
              zone: "z",
              priority: "low",
              difficulty: 1,
            },
          },
          { user: stranger },
        ),
      ).rejects.toThrow();
    });
  });

  describe("discard", () => {
    it("sets status to discarded", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user);
      const beacon = await seedBeacon(ctx, campaignId);

      const res = await ctx.beaconController.discard.fetch(
        { params: { campaignId, beaconId: beacon.id } },
        { user },
      );
      expect(res.data.ok).toBe(true);

      const repo = ctx.alepha.inject(RepositoryProvider).getRepository(beacons);
      const updated = await repo.findById(beacon.id);
      expect(updated?.status).toBe("discarded");
    });
  });

  describe("regenerateToken", () => {
    it("changes the campaign's publicToken to a fresh pk_ value", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user);

      const repo = ctx.alepha
        .inject(RepositoryProvider)
        .getRepository(campaigns);
      const before = await repo.findById(campaignId);
      const oldToken = before?.beacons?.publicToken;

      const res = await ctx.beaconController.regenerateToken.fetch(
        { params: { campaignId } },
        { user },
      );

      expect(res.data.publicToken).toMatch(/^pk_[a-f0-9]+$/);
      expect(res.data.publicToken).not.toBe(oldToken);

      const after = await repo.findById(campaignId);
      expect(after?.beacons?.publicToken).toBe(res.data.publicToken);
      expect(after?.beacons?.enabled).toBe(true);
      expect(after?.beacons?.allowedOrigins).toEqual(["example.com"]);
    });

    it("rejects regeneration when beacons are not configured", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user, false);

      await expect(
        ctx.beaconController.regenerateToken.fetch(
          { params: { campaignId } },
          { user },
        ),
      ).rejects.toThrow(/not configured/i);
    });
  });

  describe("list", () => {
    it("filters by status (default = new)", async () => {
      const user = await createTestUser(ctx);
      const campaignId = await createTestCampaign(ctx, user);

      await seedBeacon(ctx, campaignId, { title: "n1", status: "new" });
      await seedBeacon(ctx, campaignId, { title: "n2", status: "new" });
      await seedBeacon(ctx, campaignId, { title: "p1", status: "promoted" });
      await seedBeacon(ctx, campaignId, { title: "d1", status: "discarded" });

      const def = await ctx.beaconController.list.fetch(
        { params: { campaignId }, query: {} },
        { user },
      );
      expect(def.data.items).toHaveLength(2);
      expect(def.data.items.every((b) => b.status === "new")).toBe(true);

      const promoted = await ctx.beaconController.list.fetch(
        { params: { campaignId }, query: { status: "promoted" } },
        { user },
      );
      expect(promoted.data.items).toHaveLength(1);
      expect(promoted.data.items[0].title).toBe("p1");

      const all = await ctx.beaconController.list.fetch(
        { params: { campaignId }, query: { status: "all" } },
        { user },
      );
      expect(all.data.items).toHaveLength(4);
    });
  });
});
