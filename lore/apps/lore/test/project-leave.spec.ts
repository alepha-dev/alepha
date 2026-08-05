import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
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

describe("ProjectController leaveProject", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rejects the owner with 403", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    await expect(
      ctx.projectController.leaveProject.fetch(
        { params: { id: created.data.id } },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("is a no-op when the user is not a member", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Stranger danger" } },
      { user: owner },
    );

    const result = await ctx.projectController.leaveProject.fetch(
      { params: { id: created.data.id } },
      { user: stranger },
    );

    expect(result.data.ok).toBe(true);
  });

  it("removes the membership so the project drops out of getMyProjects", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Leaving party" } },
      { user: owner },
    );

    // Direct repo insert — the standard membership path is through
    // invitations, which is more plumbing than this test needs. Reach into
    // the controller's repository to seed a non-owner character.
    const membersRepo = (ctx.projectController as any).members;
    await membersRepo.create({
      userId: member.id,
      projectId: created.data.id,
      owner: false,
    });

    // Sanity: project is visible to the member before leaving.
    const before = await ctx.projectController.getMyProjects.fetch(
      { query: { size: 50, sort: "-updatedAt" } },
      { user: member },
    );
    expect(before.data.some((c) => c.id === created.data.id)).toBe(true);

    await ctx.projectController.leaveProject.fetch(
      { params: { id: created.data.id } },
      { user: member },
    );

    const after = await ctx.projectController.getMyProjects.fetch(
      { query: { size: 50, sort: "-updatedAt" } },
      { user: member },
    );
    expect(after.data.some((c) => c.id === created.data.id)).toBe(false);
  });
});
