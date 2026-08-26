import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "../src/api/controllers/ProjectQuestPortabilityController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { AreaService } from "../src/api/services/AreaService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  questController: QuestController;
  portController: ProjectQuestPortabilityController;
  areaService: AreaService;
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
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    portController: alepha.inject(ProjectQuestPortabilityController),
    areaService: alepha.inject(AreaService),
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

async function createTestProject(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  title = "Test Project",
): Promise<{ id: number; title: string }> {
  const response = await ctx.projectController.createProject.fetch(
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
    const c1 = await createTestProject(ctx, owner, "Project One");

    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: c1.id,
          title: "Plain",
          description: "",
          area: "",
          priority: "medium",
        },
      },
      { user: owner },
    );
    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: c1.id,
          title: `He said "go"`,
          description: "<p>line one</p><p>line two</p>",
          area: "North",
          priority: "high",
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
          projectId: c1.id,
          title: "Empty area",
          description: "",
          area: "",
          priority: "low",
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

    // Re-import into a fresh project — every row should CREATE.
    const c2 = await createTestProject(ctx, owner, "Project Two");
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

    // Re-import into the ORIGINAL project = full upsert, zero creates.
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

  it("neutralises a formula title on export and re-imports it unchanged", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner, "Injection");

    const title = '=HYPERLINK("https://evil.example","Click me")';
    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title,
          description: "",
          area: "",
          priority: "medium",
        },
      },
      { user: owner },
    );

    const exportResponse = await ctx.portController.exportQuests.fetch(
      { params: { id: project.id } },
      { user: owner },
    );
    const csv = await exportResponse.data.text();

    // What a spreadsheet opens: the cell no longer starts on `=`, so it is
    // text rather than a formula.
    expect(csv).toContain(`"'${title.replace(/"/g, '""')}"`);

    // ...and the apostrophe is the export's, not the title's.
    const target = await createTestProject(ctx, owner, "Injection Target");
    const importResponse = await ctx.portController.importQuests.fetch(
      {
        params: { id: target.id },
        body: { file: new File([csv], "quests.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );
    expect(importResponse.data.created).toBe(1);
    expect(importResponse.data.errors).toEqual([]);

    const imported = await ctx.questController.getQuests.fetch(
      { params: { projectId: target.id }, query: {} },
      { user: owner },
    );
    expect(imported.data.content.map((q) => q.title)).toEqual([title]);
  });

  it("registers a new area when an upsert-mode import changes an existing quest onto it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner);

    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Streaming ZIP writer",
          description: "",
          area: "alepha/orm",
          priority: "medium",
        },
      },
      { user: owner },
    );

    const exportResponse = await ctx.portController.exportQuests.fetch(
      { params: { id: project.id } },
      { user: owner },
    );
    const csv = await exportResponse.data.text();

    // Same shortId, area edited to a name that doesn't exist yet — exactly
    // what a person does when they tweak a column in the exported CSV and
    // re-upload it. Re-importing into the SAME project matches by shortId,
    // so this is the upsert branch, not the create branch.
    const edited = csv.replace('"alepha/orm"', '"alepha/system"');

    const importResponse = await ctx.portController.importQuests.fetch(
      {
        params: { id: project.id },
        body: { file: new File([edited], "quests.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );
    expect(importResponse.data.updated).toBe(1);
    expect(importResponse.data.created).toBe(0);

    const areas = await ctx.areaService.listWithStats(project.id);
    expect(areas.map((a) => a.name)).toContain("alepha/system");
  });

  it("keeps earlier rows' results when a later row fails, instead of losing the whole import", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner);

    // Two create-mode rows (blank shortId). The second row's area is one
    // character past `areas.name`'s 48-char cap — `questCreateSchema`'s
    // own `.max(48)` now rejects it as a clean validation error instead of
    // the row silently succeeding (or throwing an opaque 500 out of
    // `ensureArea`), but that rejection must not throw the whole import
    // request away and discard row one's already-committed create.
    const csv = [
      "shortId,title,area,priority,difficulty",
      ",First,short-area,medium,2",
      `,Second,${"x".repeat(49)},medium,2`,
    ].join("\n");

    const importResponse = await ctx.portController.importQuests.fetch(
      {
        params: { id: project.id },
        body: { file: new File([csv], "quests.csv", { type: "text/csv" }) },
      },
      { user: owner },
    );

    expect(importResponse.data.created).toBe(1);
    expect(importResponse.data.skipped).toBe(1);
    expect(importResponse.data.errors).toHaveLength(1);
    expect(importResponse.data.errors[0].row).toBe(2);
  });
});
