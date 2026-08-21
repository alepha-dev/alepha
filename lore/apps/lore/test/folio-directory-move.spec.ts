import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
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
  directoryController: DirectoryController;
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
    directoryController: alepha.inject(DirectoryController),
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

/**
 * Regression guard for a bug the folio tree pane's drag-to-root gesture
 * surfaced live (Task 9): `FolioDirectoryService.move()` moving a directory
 * to the project root passes `parentId: undefined` to `updateById` — and an
 * object key present with value `undefined` is exactly what Drizzle's
 * `.set()` silently skips (the same rule `FolioController.update`'s own
 * `directoryId` handling exists to work around, one file over). Before the
 * fix, `moveDirectory` returned 200 with the row's `updatedAt` bumped (the
 * `name` write went through) but `parentId` silently unchanged — a
 * directory could never actually be moved to root through this endpoint.
 */
describe("FolioDirectoryService.move — project-root regression", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("moves a nested directory to the project root", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Tree move regression" } },
      { user: owner },
    );

    const parent = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: project.data.id }, body: { name: "Parent" } },
      { user: owner },
    );
    const child = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: project.data.id },
        body: { name: "Child", parentId: parent.data.id },
      },
      { user: owner },
    );
    expect(child.data.parentId).toBe(parent.data.id);

    // The exact call the tree's drag & drop makes for "move to root":
    // `body: { parentId }` with `parentId` omitted (not `null` — that's
    // the folio-move asymmetry the tree pane's model doc calls out).
    const moved = await ctx.directoryController.moveDirectory.fetch(
      { params: { id: child.data.id }, body: {} },
      { user: owner },
    );
    expect(moved.data.parentId).toBeUndefined();

    // Re-fetch independently of the mutation's own response, in case the
    // response were ever constructed from the input rather than the
    // persisted row.
    const listed = await ctx.directoryController.listAllDirectories.fetch(
      { params: { projectId: project.data.id } },
      { user: owner },
    );
    const persisted = listed.data.find((d) => d.id === child.data.id);
    expect(persisted?.parentId).toBeUndefined();
  });

  it("still moves a directory under a real target parent (unaffected by the fix)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Tree move regression 2" } },
      { user: owner },
    );

    const a = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: project.data.id }, body: { name: "A" } },
      { user: owner },
    );
    const b = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: project.data.id }, body: { name: "B" } },
      { user: owner },
    );

    const moved = await ctx.directoryController.moveDirectory.fetch(
      { params: { id: b.data.id }, body: { parentId: a.data.id } },
      { user: owner },
    );
    expect(moved.data.parentId).toBe(a.data.id);
  });
});
