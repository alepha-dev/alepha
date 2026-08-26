import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioNameService } from "../src/api/services/FolioNameService.ts";

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
  names: FolioNameService;
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
    folioController: alepha.inject(FolioController),
    names: alepha.inject(FolioNameService),
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
 * Folios share one namespace with directories, per folder - the promise
 * `FolioNameService` and the `folio_names` entity both document. Until
 * this spec, only directories ever wrote a reservation, so the guard was
 * a claim rather than a rule: two folios could take the same name in one
 * folder, and `FolioDirectoryService.delete`'s release loop had nothing
 * to release.
 */
describe("Folio name reservations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const project = async (owner: { id: string; roles: string[] }) => {
    const response = await ctx.projectController.createProject.fetch(
      { body: { title: `Names ${crypto.randomUUID().slice(0, 8)}` } },
      { user: owner },
    );
    return response.data;
  };

  it("auto-suffixes a second folio taking a taken name at the root", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);

    const first = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Notes" } },
      { user: owner },
    );
    const second = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Notes" } },
      { user: owner },
    );

    expect(first.data.title).toBe("Notes");
    expect(second.data.title).toBe("Notes (1)");
  });

  it("matches case-insensitively, the way the directory side does", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);

    await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Notes" } },
      { user: owner },
    );
    const clash = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "NOTES" } },
      { user: owner },
    );
    expect(clash.data.title).toBe("NOTES (1)");
  });

  it("shares the namespace with directories in the same folder", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);

    await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Specs" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Specs" } },
      { user: owner },
    );
    expect(folio.data.title).toBe("Specs (1)");

    // ...and the other way round: a directory cannot take a folio's name.
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Specs (1)" } },
      { user: owner },
    );
    expect(dir.data.name).toBe("Specs (1) (1)");
  });

  it("scopes the namespace per directory, not per project", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Sub" } },
      { user: owner },
    );

    const atRoot = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Notes" } },
      { user: owner },
    );
    const inSub = await ctx.folioController.create.fetch(
      {
        body: { projectId: p.id, title: "Notes", directoryId: dir.data.id },
      },
      { user: owner },
    );
    expect(atRoot.data.title).toBe("Notes");
    expect(inSub.data.title).toBe("Notes");
  });

  it("re-reserves on rename and on move", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Sub" } },
      { user: owner },
    );

    await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Taken" } },
      { user: owner },
    );
    const mover = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Mover", directoryId: dir.data.id } },
      { user: owner },
    );

    // Renaming in place keeps the same name available to nobody else...
    const renamed = await ctx.folioController.update.fetch(
      { params: { id: mover.data.id }, body: { title: "Renamed" } },
      { user: owner },
    );
    expect(renamed.data.title).toBe("Renamed");
    expect(
      await ctx.names.isFree("Renamed", { parentDirectoryId: dir.data.id }),
    ).toBe(false);
    expect(
      await ctx.names.isFree("Mover", { parentDirectoryId: dir.data.id }),
    ).toBe(true);

    // ...and moving it to root collides with the folio already called
    // "Taken" only if it is renamed onto that name.
    const moved = await ctx.folioController.update.fetch(
      {
        params: { id: mover.data.id },
        body: { title: "Taken", directoryId: null },
      },
      { user: owner },
    );
    expect(moved.data.title).toBe("Taken (1)");
    expect(
      await ctx.names.isFree("Renamed", { parentDirectoryId: dir.data.id }),
    ).toBe(true);
  });

  it("lets the UNIQUE index refuse a duplicate inside a directory", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Sub" } },
      { user: owner },
    );

    // `autoSuffix` is the convenience layer; this is the guarantee under
    // it, the one two racing writers land on. It held only at the project
    // root until `root_scope` stopped being NULL inside a directory -
    // SQLite counts a row with a NULL in the index as distinct from every
    // other, so the index was simply off for every name in a folder.
    const scope = { parentDirectoryId: dir.data.id };
    await ctx.names.reserve("Notes", "folio", crypto.randomUUID(), scope);
    await expect(
      ctx.names.reserve("notes", "folio", crypto.randomUUID(), scope),
    ).rejects.toThrowError();
  });

  it("releases the name when the folio is deleted", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);

    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Ephemeral" } },
      { user: owner },
    );
    expect(
      await ctx.names.isFree("Ephemeral", { rootScope: String(p.id) }),
    ).toBe(false);

    await ctx.folioController.delete.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(
      await ctx.names.isFree("Ephemeral", { rootScope: String(p.id) }),
    ).toBe(true);

    // The name is genuinely reusable, not merely reported free.
    const reborn = await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Ephemeral" } },
      { user: owner },
    );
    expect(reborn.data.title).toBe("Ephemeral");
  });

  it("releases the names of folios a cascading directory delete takes with it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: p.id }, body: { name: "Doomed" } },
      { user: owner },
    );
    await ctx.folioController.create.fetch(
      { body: { projectId: p.id, title: "Inside", directoryId: dir.data.id } },
      { user: owner },
    );

    await ctx.directoryController.deleteDirectory.fetch(
      { params: { id: dir.data.id }, query: { cascade: true } },
      { user: owner },
    );

    // The scope itself is gone, so the only thing left to check is that
    // no reservation row survived its entity.
    expect(
      await ctx.names.isFree("Inside", { parentDirectoryId: dir.data.id }),
    ).toBe(true);
    expect(await ctx.names.isFree("Doomed", { rootScope: String(p.id) })).toBe(
      true,
    );
  });
});
