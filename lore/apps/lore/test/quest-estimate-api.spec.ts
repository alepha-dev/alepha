import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  fake: FakeProvider;
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
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
  };
};

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
) => {
  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Estimate Probe" } },
    { user },
  );
  return project.data.id;
};

describe("QuestController estimateMinutes", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("persists estimateMinutes on create and returns it on the resource", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Buy groceries",
          description: "<p>x</p>",
          area: "errands",
          priority: "low",
          estimateMinutes: 15,
        },
      },
      { user },
    );

    expect(created.data.estimateMinutes).toBe(15);
  });

  it("defaults to no estimate when omitted", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "No estimate",
          description: "<p>x</p>",
          area: "errands",
          priority: "low",
        },
      },
      { user },
    );

    expect(created.data.estimateMinutes ?? null).toBeNull();
  });

  it("updates the estimate and clears it with null", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Tweak estimate",
          description: "<p>x</p>",
          area: "errands",
          priority: "low",
          estimateMinutes: 30,
        },
      },
      { user },
    );

    const bumped = await ctx.quests.updateQuestById.fetch(
      { params: { id: created.data.id }, body: { estimateMinutes: 120 } },
      { user },
    );
    expect(bumped.data.estimateMinutes).toBe(120);

    const cleared = await ctx.quests.updateQuestById.fetch(
      { params: { id: created.data.id }, body: { estimateMinutes: null } },
      { user },
    );
    expect(cleared.data.estimateMinutes ?? null).toBeNull();
  });

  it("stores a non-positive estimate as none", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Bad estimate",
          description: "<p>x</p>",
          area: "errands",
          priority: "low",
          estimateMinutes: 0,
        },
      },
      { user },
    );

    expect(created.data.estimateMinutes ?? null).toBeNull();
  });
});
