import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
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
  folioController: FolioController;
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
    folioController: alepha.inject(FolioController),
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
 * #Q2510: the tree, the router's seed and the pickers asked `list` for 100
 * folios, and the server caps it there. Past 100, older folios were simply
 * missing from the tree and could not be picked. `tree` is unpaged and
 * carries no bodies, except a pinned unprotected folio's, which the
 * pinned-budget bar sums.
 */
describe("FolioController.tree", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns every folio past 100, without bodies", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Tree past a hundred" } },
      { user: owner },
    );
    const projectId = created.data.id;

    for (let i = 0; i < 120; i++) {
      await ctx.folioController.create.fetch(
        { body: { projectId, title: `Folio ${i}`, content: `body ${i}` } },
        { user: owner },
      );
    }

    // The capped page it replaces, for contrast.
    const page = await ctx.folioController.list.fetch(
      { query: { projectId, limit: 100 } },
      { user: owner },
    );
    expect(page.data).toHaveLength(100);

    const tree = await ctx.folioController.tree.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(tree.data).toHaveLength(120);
    expect(new Set(tree.data.map((f) => f.title)).size).toBe(120);
    expect(tree.data.every((f) => f.content === undefined)).toBe(true);
    expect(tree.data[0]).not.toHaveProperty("searchText");
  });

  it("carries the body of a pinned folio, and only that one", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Tree pinned body" } },
      { user: owner },
    );
    const projectId = created.data.id;

    const pinned = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Rules", content: "the pinned body" } },
      { user: owner },
    );
    await ctx.folioController.update.fetch(
      { params: { id: pinned.data.id }, body: { pinned: true } },
      { user: owner },
    );
    await ctx.folioController.create.fetch(
      { body: { projectId, title: "Notes", content: "an ordinary body" } },
      { user: owner },
    );

    const tree = await ctx.folioController.tree.fetch(
      { params: { projectId } },
      { user: owner },
    );
    const rules = tree.data.find((f) => f.title === "Rules");
    const notes = tree.data.find((f) => f.title === "Notes");
    expect(rules?.content).toBe("the pinned body");
    expect(notes?.content).toBeUndefined();
    // Pinned first, as the tree draws it.
    expect(tree.data[0]?.title).toBe("Rules");
  });

  it("refuses a caller who is not a member", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Tree private" } },
      { user: owner },
    );

    await expect(
      ctx.folioController.tree.fetch(
        { params: { projectId: created.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});
