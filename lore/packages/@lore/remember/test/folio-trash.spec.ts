import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { $repository } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  DirectoryController,
  FolioController,
  FolioTrashService,
  LoreRememberApi,
} from "../src/api/index.ts";
import { folioDirectories, folios } from "../src/schemas/index.ts";

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
  folioController: FolioController;
  trash: FolioTrashService;
  rows: TrashRows;
  fakeProvider: FakeProvider;
}

class TrashRows {
  directories = $repository(folioDirectories);
  folios = $repository(folios);
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
  alepha.with(LoreRememberApi);
  alepha.with(TrashRows);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    directoryController: alepha.inject(DirectoryController),
    folioController: alepha.inject(FolioController),
    trash: alepha.inject(FolioTrashService),
    rows: alepha.inject(TrashRows),
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
 * The folio trash (#Q3659): one per project, made on demand or adopted,
 * never renamed, moved or deleted, stamping what goes in and emptying what
 * sat there 30 days.
 */
describe("the folio trash", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const project = async () => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Trash" } },
      { user: owner },
    );
    return { owner, projectId: created.data.id };
  };

  it("makes the trash on the first read of the tree, once", async ({
    expect,
  }) => {
    const { owner, projectId } = await project();
    const list = async () =>
      (
        await ctx.directoryController.listAllDirectories.fetch(
          { params: { projectId } },
          { user: owner },
        )
      ).data;

    const first = await list();
    const second = await list();
    expect(first.filter((d) => d.system === "trash")).toHaveLength(1);
    expect(second.filter((d) => d.system === "trash")).toHaveLength(1);
    expect(first.find((d) => d.system === "trash")?.name).toBe("Trash");
  });

  it("adopts a root directory a person called trash, rather than adding one", async ({
    expect,
  }) => {
    const { owner, projectId } = await project();
    const mine = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId }, body: { name: "trash" } },
      { user: owner },
    );

    const trash = await ctx.trash.ensure(projectId);

    expect(trash.id).toBe(mine.data.id);
    const all = await ctx.rows.directories.findMany({
      where: { projectId: { eq: projectId } },
    });
    expect(all).toHaveLength(1);
  });

  it("refuses to rename, move or delete the trash", async ({ expect }) => {
    const { owner, projectId } = await project();
    const trash = await ctx.trash.ensure(projectId);
    const other = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId }, body: { name: "Other" } },
      { user: owner },
    );

    await expect(
      ctx.directoryController.renameDirectory.fetch(
        { params: { id: trash.id }, body: { name: "Bin" } },
        { user: owner },
      ),
    ).rejects.toThrow("The trash cannot be renamed");
    await expect(
      ctx.directoryController.moveDirectory.fetch(
        { params: { id: trash.id }, body: { parentId: other.data.id } },
        { user: owner },
      ),
    ).rejects.toThrow("The trash cannot be moved");
    await expect(
      ctx.directoryController.deleteDirectory.fetch(
        { params: { id: trash.id } },
        { user: owner },
      ),
    ).rejects.toThrow("The trash cannot be deleted");
  });

  it("stamps what goes in, clears what comes out, and purges what sat there 30 days", async ({
    expect,
  }) => {
    const { owner, projectId } = await project();
    const trash = await ctx.trash.ensure(projectId);
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId }, body: { name: "Old notes" } },
      { user: owner },
    );
    const kept = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Kept" } },
      { user: owner },
    );
    const thrown = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Thrown" } },
      { user: owner },
    );

    // In: both stamped.
    await ctx.directoryController.moveDirectory.fetch(
      { params: { id: dir.data.id }, body: { parentId: trash.id } },
      { user: owner },
    );
    for (const id of [kept.data.id, thrown.data.id]) {
      await ctx.folioController.update.fetch(
        { params: { id }, body: { directoryId: trash.id } },
        { user: owner },
      );
    }
    expect(
      (await ctx.rows.directories.findById(dir.data.id))?.trashedAt,
    ).toBeDefined();
    expect(
      (await ctx.rows.folios.findById(thrown.data.id))?.trashedAt,
    ).toBeDefined();

    // Out: restored, the stamp cleared.
    await ctx.folioController.update.fetch(
      { params: { id: kept.data.id }, body: { directoryId: null } },
      { user: owner },
    );
    expect(
      (await ctx.rows.folios.findById(kept.data.id))?.trashedAt,
    ).toBeUndefined();

    // 29 days on: nothing goes. 31: what is still in the trash does.
    const time = ctx.alepha.inject(DateTimeProvider);
    await time.travel([29, "days"]);
    expect(await ctx.trash.purge()).toEqual({ folios: 0, directories: 0 });
    await time.travel([2, "days"]);
    await ctx.trash.purge();

    expect(await ctx.rows.folios.findById(thrown.data.id)).toBeUndefined();
    expect(await ctx.rows.directories.findById(dir.data.id)).toBeUndefined();
    expect(await ctx.rows.folios.findById(kept.data.id)).toBeDefined();
    expect(await ctx.rows.directories.findById(trash.id)).toBeDefined();
  });
});
