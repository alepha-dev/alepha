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
import { ChapterController } from "../src/api/controllers/ChapterController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ChapterJobs } from "../src/api/jobs/ChapterJobs.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  chapterController: ChapterController;
  chapterJobs: ChapterJobs;
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
    chapterController: alepha.inject(ChapterController),
    chapterJobs: alepha.inject(ChapterJobs),
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
  chapterDuration?: string,
): Promise<{ id: number }> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Test Campaign" } },
    { user },
  );
  if (chapterDuration) {
    await ctx.campaignController.updateCampaignById.fetch(
      {
        params: { id: created.data.id },
        body: { chapterDuration },
      },
      { user },
    );
  }
  return { id: created.data.id };
};

describe("ChapterJobs.autoCloseExpiredChapters", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("auto-closes a chapter whose deadline has passed", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, user, "PT1H");

    const started = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaign.id }, body: {} },
      { user },
    );
    expect(started.data.closesAt).toBeDefined();
    expect(started.data.closedAt).toBeUndefined();

    await ctx.dt.travel([2, "hours"]);
    await ctx.chapterJobs.autoCloseExpiredChapters.trigger();

    const after = await ctx.chapterController.chapters.getById(started.data.id);
    expect(after.closedAt).toBeDefined();
    expect(after.changelog).toBeDefined();
  });

  it("leaves chapters with a future deadline untouched", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, user, "P7D");

    const started = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaign.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "hour"]);
    await ctx.chapterJobs.autoCloseExpiredChapters.trigger();

    const after = await ctx.chapterController.chapters.getById(started.data.id);
    expect(after.closedAt).toBeUndefined();
    expect(after.changelog).toBeUndefined();
  });

  it("leaves chapters with no deadline untouched", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, user);

    const started = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaign.id }, body: {} },
      { user },
    );
    expect(started.data.closesAt).toBeUndefined();

    await ctx.dt.travel([30, "days"]);
    await ctx.chapterJobs.autoCloseExpiredChapters.trigger();

    const after = await ctx.chapterController.chapters.getById(started.data.id);
    expect(after.closedAt).toBeUndefined();
  });

  it("does not re-finalize an already-closed chapter", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, user, "PT1H");

    const started = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaign.id }, body: {} },
      { user },
    );
    const closed = await ctx.chapterController.closeChapter.fetch(
      { params: { id: started.data.id }, body: {} },
      { user },
    );
    const originalClosedAt = closed.data.closedAt;
    expect(originalClosedAt).toBeDefined();

    await ctx.dt.travel([2, "hours"]);
    await ctx.chapterJobs.autoCloseExpiredChapters.trigger();

    const after = await ctx.chapterController.chapters.getById(started.data.id);
    expect(after.closedAt).toBe(originalClosedAt);
  });

  it("auto-closes chapters across multiple campaigns in one tick", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const campaignA = await createTestCampaign(ctx, user, "PT1H");
    const campaignB = await createTestCampaign(ctx, user, "PT1H");

    const a = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaignA.id }, body: {} },
      { user },
    );
    const b = await ctx.chapterController.startChapter.fetch(
      { params: { campaignId: campaignB.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([2, "hours"]);
    await ctx.chapterJobs.autoCloseExpiredChapters.trigger();

    const afterA = await ctx.chapterController.chapters.getById(a.data.id);
    const afterB = await ctx.chapterController.chapters.getById(b.data.id);
    expect(afterA.closedAt).toBeDefined();
    expect(afterB.closedAt).toBeDefined();
  });
});
