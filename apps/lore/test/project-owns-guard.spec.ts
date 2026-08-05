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

/**
 * Denial coverage for the `$owns` gates on ProjectController.
 *
 * The rest of the project suite only exercises happy paths, so it would stay
 * green if the gates were dropped entirely. These tests fail if the membership
 * or owner check stops being enforced — which is the whole point of moving
 * them out of handler bodies and into the middleware chain.
 */

const adminUser = {
  id: crypto.randomUUID(),
  roles: ["admin"],
  realm: "default",
};

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

describe("ProjectController $owns gates", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lets the owner read the member list", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    const response = await ctx.projectController.getProjectUsers.fetch(
      { params: { id: created.data.id } },
      { user: owner },
    );

    expect(Array.isArray(response.data)).toBe(true);
  });

  it("denies a non-member reading the member list", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    await expect(
      ctx.projectController.getProjectUsers.fetch(
        { params: { id: created.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  it("denies a non-owner updating the project", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    await expect(
      ctx.projectController.updateProjectById.fetch(
        {
          params: { id: created.data.id },
          body: { title: "Hijacked" },
        },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  it("lets the owner update the project", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    const updated = await ctx.projectController.updateProjectById.fetch(
      { params: { id: created.data.id }, body: { title: "Renamed" } },
      { user: owner },
    );

    expect(updated.data.title).toBe("Renamed");
  });

  it("lets a privileged identity through without membership", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    // `admin` resolves to `ownership: false` via the realm's wildcard
    // permission — the privileged bypass both gates honour.
    const response = await ctx.projectController.getProjectUsers.fetch(
      { params: { id: created.data.id } },
      { user: adminUser },
    );

    expect(Array.isArray(response.data)).toBe(true);
  });
});
