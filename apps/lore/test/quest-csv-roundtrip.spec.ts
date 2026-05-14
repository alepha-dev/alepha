import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { CampaignQuestPortabilityController } from "../src/api/controllers/CampaignQuestPortabilityController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
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
  questController: QuestController;
  portController: CampaignQuestPortabilityController;
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
    questController: alepha.inject(QuestController),
    portController: alepha.inject(CampaignQuestPortabilityController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

async function createTestUser(
  ctx: TestContext,
  roles: string[] = ["user"],
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

async function createTestCampaign(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  title = "Test Campaign",
): Promise<{ id: number; title: string }> {
  const response = await ctx.campaignController.createCampaign.fetch(
    { body: { title } },
    { user },
  );
  return { id: response.data.id, title: response.data.title };
}

describe("Quest CSV roundtrip", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("exports quests and re-imports them losslessly", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const c1 = await createTestCampaign(ctx, owner, "Campaign One");

    await ctx.questController.createQuest.fetch(
      {
        body: {
          campaignId: c1.id,
          title: "Plain",
          description: "",
          zone: "",
          priority: "medium",
          difficulty: 1,
        },
      },
      { user: owner },
    );
    await ctx.questController.createQuest.fetch(
      {
        body: {
          campaignId: c1.id,
          title: `He said "go"`,
          description: "<p>line one</p><p>line two</p>",
          zone: "North",
          priority: "high",
          difficulty: 4,
          objectives: [
            { title: "Step one", completed: true },
            { title: "Step two", completed: false },
          ],
        },
      },
      { user: owner },
    );
    await ctx.questController.createQuest.fetch(
      {
        body: {
          campaignId: c1.id,
          title: "Empty zone",
          description: "",
          zone: "",
          priority: "low",
          difficulty: 2,
        },
      },
      { user: owner },
    );

    const exportResponse = await ctx.portController.exportQuests.fetch(
      { params: { id: c1.id } },
      { user: owner },
    );
    const file = exportResponse.data;
    const csv = await file.text();

    // Re-import into a fresh campaign — every row should CREATE.
    const c2 = await createTestCampaign(ctx, owner, "Campaign Two");
    const importResponse = await ctx.portController.importQuests.fetch(
      {
        params: { id: c2.id },
        body: { file: new File([csv], "quests.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );
    const result = importResponse.data;
    expect(result.format).toBe("alepha-lore");
    expect(result.totalRows).toBe(3);
    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    // Re-import into the ORIGINAL campaign = full upsert, zero creates.
    const importResponse2 = await ctx.portController.importQuests.fetch(
      {
        params: { id: c1.id },
        body: { file: new File([csv], "quests.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );
    const result2 = importResponse2.data;
    expect(result2.created).toBe(0);
    expect(result2.updated).toBe(3);
  });
});
