import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilJobs } from "../src/api/jobs/SigilJobs.ts";
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
  sigilJobs: SigilJobs;
  dt: DateTimeProvider;
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
    sigilController: alepha.inject(SigilController),
    sigilJobs: alepha.inject(SigilJobs),
    dt: alepha.inject(DateTimeProvider),
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

const createTestCampaign = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  retentionDays?: number,
): Promise<{ id: number }> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Purge Test" } },
    { user },
  );
  if (retentionDays !== undefined) {
    await ctx.campaignController.updateCampaignById.fetch(
      { params: { id: created.data.id }, body: { retentionDays } },
      { user },
    );
  }
  return { id: created.data.id };
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
        label: "purge sigil",
        kinds: ["blights"],
      },
    },
    { user },
  );
  return created.data.id;
};

/** Direct-insert a blight row with a controlled `lastSeenAt` and `status`. */
const insertBlight = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blights: any,
  sigilId: string,
  fingerprint: string,
  lastSeenAt: string,
  status: string,
): Promise<void> => {
  await blights.create({
    sigilId,
    fingerprint,
    name: "Error",
    message: "boom",
    stack: "",
    sourceUrl: "",
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    count: 1,
    recentIps: [],
    status,
  });
};

describe("SigilJobs.purgeStaleBlights", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("deletes old open blights, keeps resolved and quest-forwarded ones", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, user); // default 30d
    const sigilId = await createSigil(ctx, campaign.id, user);
    const blights = (ctx.alepha.inject(BlightIngestService) as any).blights;

    const old = new Date(
      ctx.dt.nowMillis() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recent = new Date(
      ctx.dt.nowMillis() - 2 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await insertBlight(blights, sigilId, "fp-old-open", old, "open");
    await insertBlight(blights, sigilId, "fp-old-resolved", old, "resolved");
    await insertBlight(blights, sigilId, "fp-old-quest", old, "quest:42");
    await insertBlight(blights, sigilId, "fp-recent-open", recent, "open");

    await ctx.sigilJobs.purgeStaleBlights.trigger();

    const remaining = await blights.findMany({
      where: { sigilId: { eq: sigilId } },
    });
    const fps = remaining
      .map((b: { fingerprint: string }) => b.fingerprint)
      .sort();
    expect(fps).toEqual(["fp-old-quest", "fp-old-resolved", "fp-recent-open"]);
  });

  it("skips a campaign with no sigils (the empty-campaignSigils continue path)", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    // Campaign with a sigil + stale blight...
    const withSigil = await createTestCampaign(ctx, user);
    const sigilId = await createSigil(ctx, withSigil.id, user);
    // ...and a second campaign with NO sigils at all.
    await createTestCampaign(ctx, user);
    const blights = (ctx.alepha.inject(BlightIngestService) as any).blights;

    const old = new Date(
      ctx.dt.nowMillis() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await insertBlight(blights, sigilId, "fp-old-open", old, "open");

    // The sigil-less campaign hits the `continue` and is a no-op; the
    // run must still purge the other campaign's stale blight.
    await ctx.sigilJobs.purgeStaleBlights.trigger();

    const remaining = await blights.findMany({
      where: { sigilId: { eq: sigilId } },
    });
    expect(remaining).toHaveLength(0);
  });

  it("isolates a failing campaign so healthy campaigns are still purged", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const healthy = await createTestCampaign(ctx, user);
    const healthySigil = await createSigil(ctx, healthy.id, user);
    const broken = await createTestCampaign(ctx, user);
    const brokenSigil = await createSigil(ctx, broken.id, user);
    const blights = (ctx.alepha.inject(BlightIngestService) as any).blights;

    const old = new Date(
      ctx.dt.nowMillis() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await insertBlight(blights, healthySigil, "fp-healthy-old", old, "open");
    await insertBlight(blights, brokenSigil, "fp-broken-old", old, "open");

    // Force the first-processed campaign's blight delete to throw, so the
    // per-campaign try/catch is exercised. The handler must not abort —
    // the other campaign's stale blight is still purged.
    const realDeleteMany = blights.deleteMany.bind(blights);
    let thrown = false;
    blights.deleteMany = async (where: unknown) => {
      if (!thrown) {
        thrown = true;
        throw new Error("simulated purge failure");
      }
      return realDeleteMany(where);
    };

    try {
      await ctx.sigilJobs.purgeStaleBlights.trigger();
    } finally {
      blights.deleteMany = realDeleteMany;
    }

    // Exactly one campaign's delete failed; the other still purged. The
    // total surviving stale-open blights across both campaigns is 1.
    const survivingHealthy = await blights.findMany({
      where: { sigilId: { eq: healthySigil } },
    });
    const survivingBroken = await blights.findMany({
      where: { sigilId: { eq: brokenSigil } },
    });
    expect(survivingHealthy.length + survivingBroken.length).toBe(1);
  });

  it("respects a per-campaign retentionDays override", async ({ expect }) => {
    const user = await createTestUser(ctx);
    // 7-day retention — a 10-day-old open blight is now stale.
    const campaign = await createTestCampaign(ctx, user, 7);
    const sigilId = await createSigil(ctx, campaign.id, user);
    const blights = (ctx.alepha.inject(BlightIngestService) as any).blights;

    const tenDaysOld = new Date(
      ctx.dt.nowMillis() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await insertBlight(blights, sigilId, "fp-10d", tenDaysOld, "open");

    await ctx.sigilJobs.purgeStaleBlights.trigger();

    const remaining = await blights.findMany({
      where: { sigilId: { eq: sigilId } },
    });
    // Under the default 30d it would survive; under 7d it is purged.
    expect(remaining).toHaveLength(0);
  });
});
