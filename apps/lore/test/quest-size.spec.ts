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
    { body: { title: "Size Probe" } },
    { user },
  );
  return project.data.id;
};

describe("quest size", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("defaults to 3 when the caller omits it", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    // The path Lore's own creators take — blight forwarding and feedback
    // acceptance have no basis for a size, and must not have to invent one.
    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Unsized",
          description: "",
          area: "test",
          priority: "low",
        },
      },
      { user },
    );

    expect(created.data.size).toBe(3);
  });

  it("stores the size the caller picked", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Chunky",
          description: "",
          area: "test",
          priority: "low",
          size: 5,
        },
      },
      { user },
    );

    expect(created.data.size).toBe(5);
  });

  it("updates the size in place", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Resized",
          description: "",
          area: "test",
          priority: "low",
          size: 1,
        },
      },
      { user },
    );

    const updated = await ctx.quests.updateQuestById.fetch(
      { params: { id: created.data.id }, body: { size: 4 } },
      { user },
    );

    expect(updated.data.size).toBe(4);
  });

  it("refuses a size outside the 1-5 scale", async ({ expect }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);

    // The scale is closed: a 6 is not clamped to 5, because a caller that
    // meant something outside the scale did not mean XL either.
    await expect(
      ctx.quests.createQuest.fetch(
        {
          body: {
            projectId,
            title: "Off the scale",
            description: "",
            area: "test",
            priority: "low",
            size: 6,
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/size/i);
  });
});
