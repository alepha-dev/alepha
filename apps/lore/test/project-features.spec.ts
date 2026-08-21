import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
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

describe("ProjectController feature flags", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("defaults all features to true on a new project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Test Project" } },
      { user },
    );

    expect(created.data.features).toStrictEqual({
      kanban: true,
      folios: true,
      feedback: true,
      milestones: true,
    });
  });

  it("disables a single feature without dropping the others", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Test Project" } },
      { user },
    );

    const updated = await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: false } },
      },
      { user },
    );

    expect(updated.data.features).toStrictEqual({
      kanban: false,
      folios: true,
      feedback: true,
      milestones: true,
    });
  });

  it("toggles features back on without affecting the others", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Test Project" } },
      { user },
    );

    await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: false, folios: false } },
      },
      { user },
    );

    const updated = await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { kanban: true } },
      },
      { user },
    );

    expect(updated.data.features).toStrictEqual({
      kanban: true,
      folios: false,
      feedback: true,
      milestones: true,
    });
  });

  it("persists feature flags on subsequent reads", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Test Project" } },
      { user },
    );

    await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: created.data.id },
        body: { features: { feedback: false, milestones: false } },
      },
      { user },
    );

    const fetched = await ctx.projectController.getProjectById.fetch(
      { params: { id: created.data.id } },
      { user },
    );

    expect(fetched.data.features).toStrictEqual({
      kanban: true,
      folios: true,
      feedback: false,
      milestones: false,
    });
  });
});
