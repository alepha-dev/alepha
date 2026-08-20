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

describe("QuestController.getQuests — search by shortId (#94)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("bare integer matches the quest with that shortId", async ({ expect }) => {
    const user = await createUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Search probe" } },
      { user },
    );
    const cid = project.data.id;
    for (let i = 0; i < 3; i++) {
      await ctx.quests.createQuest.fetch(
        {
          body: {
            projectId: cid,
            title: `Quest ${i}`,
            description: "",
            area: "ops",
            priority: "low",
          },
        },
        { user },
      );
    }

    // shortId 2 — should return only that one.
    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { search: "2" } },
      { user },
    );
    expect(res.data.content.map((q) => q.shortId)).toEqual([2]);
  });

  it("#-prefixed integer matches the same shortId", async ({ expect }) => {
    const user = await createUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Hash probe" } },
      { user },
    );
    const cid = project.data.id;
    await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId: cid,
          title: "Alpha",
          description: "",
          area: "ops",
          priority: "low",
        },
      },
      { user },
    );

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { search: "#1" } },
      { user },
    );
    expect(res.data.content.map((q) => q.title)).toEqual(["Alpha"]);
  });

  it("non-numeric search still does a title ilike", async ({ expect }) => {
    const user = await createUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Title probe" } },
      { user },
    );
    const cid = project.data.id;
    await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId: cid,
          title: "Build the rocket",
          description: "",
          area: "ops",
          priority: "low",
        },
      },
      { user },
    );
    await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId: cid,
          title: "Refactor the launchpad",
          description: "",
          area: "ops",
          priority: "low",
        },
      },
      { user },
    );

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { search: "rocket" } },
      { user },
    );
    expect(res.data.content.map((q) => q.title)).toEqual(["Build the rocket"]);
  });

  it("shortId search returns no rows when nothing matches", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Empty probe" } },
      { user },
    );
    const cid = project.data.id;
    await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId: cid,
          title: "Only one",
          description: "",
          area: "ops",
          priority: "low",
        },
      },
      { user },
    );

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { search: "#99" } },
      { user },
    );
    expect(res.data.content).toEqual([]);
  });
});
