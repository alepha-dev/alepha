import * as fs from "node:fs";
import * as path from "node:path";
import { Alepha, z } from "alepha";
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

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
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

describe("Trello CSV import", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("maps Trello columns into Lore quests with defaults applied", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaign = await createTestCampaign(ctx, owner, "Trello migration");
    const csv = fs.readFileSync(
      path.join(__dirname, "fixtures/trello-board.csv"),
      "utf-8",
    );

    const importResponse = await ctx.portController.importQuests.fetch(
      {
        params: { id: campaign.id },
        body: { file: new File([csv], "trello.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );
    const result = importResponse.data;

    expect(result.format).toBe("trello");
    expect(result.totalRows).toBe(3);
    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(
      result.warnings.filter((w) => /acceptedBy/i.test(w.message)),
    ).toHaveLength(2);

    const exportResponse = await ctx.portController.exportQuests.fetch(
      { params: { id: campaign.id } },
      { user: owner },
    );
    const exported = await exportResponse.data.text();
    expect(exported).toContain("Refactor login");
    expect(exported).toContain("Doing");
    expect(exported).toContain("medium");
  });
});
