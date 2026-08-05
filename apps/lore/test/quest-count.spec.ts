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

const createProject = async (ctx: TestContext, user: { id: string }) => {
  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Count probe" } },
    { user },
  );
  return project.data.id;
};

const createQuest = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
  title: string,
) => {
  const res = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        description: "",
        zone: "ops",
        priority: "low",
        difficulty: 1,
      },
    },
    { user },
  );
  return res.data;
};

describe("QuestController.countOpenQuests", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("counts everything not completed", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    await createQuest(ctx, user, projectId, "a");
    const done = await createQuest(ctx, user, projectId, "b");
    await ctx.quests.acceptQuest.fetch({ params: { id: done.id } }, { user });
    await ctx.quests.completeQuest.fetch(
      { params: { id: done.id }, body: {} },
      { user },
    );

    const res = await ctx.quests.countOpenQuests.fetch(
      { params: { projectId } },
      { user },
    );

    expect(res.data.count).toBe(1);
  });

  it("counts shelved and accepted quests as open too", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const shelved = await createQuest(ctx, user, projectId, "shelved");
    await ctx.quests.shelveQuest.fetch(
      { params: { id: shelved.id } },
      { user },
    );
    const accepted = await createQuest(ctx, user, projectId, "accepted");
    await ctx.quests.acceptQuest.fetch(
      { params: { id: accepted.id } },
      { user },
    );

    const res = await ctx.quests.countOpenQuests.fetch(
      { params: { projectId } },
      { user },
    );

    expect(res.data.count).toBe(2);
  });
});
