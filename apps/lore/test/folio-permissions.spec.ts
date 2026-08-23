import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
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
 * Direct repo insert — bypass the invitation flow.
 */
const addMember = async (
  ctx: TestContext,
  userId: string,
  projectId: number,
): Promise<void> => {
  const membersRepo = (ctx.projectController as any).members;
  await membersRepo.create({
    userId,
    projectId,
    owner: false,
  });
};

describe("FolioController per-project visibility (post #65 refactor)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lets member B read a folio created by member A in the same project", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const memberB = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Shared memory" } },
      { user: owner },
    );
    await addMember(ctx, memberB.id, created.data.id);

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Owner's note",
          content: "hello world",
        },
      },
      { user: owner },
    );

    const listed = await ctx.folioController.list.fetch(
      { query: { projectId: created.data.id } },
      { user: memberB },
    );
    expect(listed.data.some((f) => f.id === folio.data.id)).toBe(true);

    const got = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: memberB },
    );
    expect(got.data.title).toBe("Owner's note");

    const byShortId = await ctx.folioController.getByShortId.fetch(
      {
        params: { projectId: created.data.id, shortId: folio.data.shortId },
        query: {},
      },
      { user: memberB },
    );
    expect(byShortId.data.id).toBe(folio.data.id);
  });

  it("lets member B edit and delete a folio created by member A", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const memberB = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Co-curated" } },
      { user: owner },
    );
    await addMember(ctx, memberB.id, created.data.id);

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Draft by owner",
          content: "rough notes",
        },
      },
      { user: owner },
    );

    const updated = await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: "polished by member B" },
      },
      { user: memberB },
    );
    expect(updated.data.content).toBe("polished by member B");

    // Owner sees the edit too.
    const seenByOwner = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(seenByOwner.data.content).toBe("polished by member B");

    // Member B can also delete.
    await ctx.folioController.delete.fetch(
      { params: { id: folio.data.id } },
      { user: memberB },
    );
    await expect(
      ctx.folioController.get.fetch(
        { params: { id: folio.data.id } },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("rejects non-members with 403 on list / get / create / delete", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Private project" } },
      { user: owner },
    );

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Owner only",
          content: "secret",
        },
      },
      { user: owner },
    );

    await expect(
      ctx.folioController.list.fetch(
        { query: { projectId: created.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);

    await expect(
      ctx.folioController.get.fetch(
        { params: { id: folio.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);

    await expect(
      ctx.folioController.create.fetch(
        {
          body: {
            projectId: created.data.id,
            title: "Stranger trespass",
          },
        },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);

    await expect(
      ctx.folioController.delete.fetch(
        { params: { id: folio.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("keeps protected folio content opaque while exposing metadata to other members", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const memberB = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Mixed sharing" } },
      { user: owner },
    );
    await addMember(ctx, memberB.id, created.data.id);

    const ciphertext = "ENCRYPTED:base64gibberish==";
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Sealed notes",
          summary: "Public summary, encrypted body",
          content: ciphertext,
          protected: true,
        },
      },
      { user: owner },
    );

    const seenByB = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: memberB },
    );
    expect(seenByB.data.title).toBe("Sealed notes");
    expect(seenByB.data.summary).toBe("Public summary, encrypted body");
    expect(seenByB.data.protected).toBe(true);
    // Content remains the opaque ciphertext — server never decrypts.
    expect(seenByB.data.content).toBe(ciphertext);
    // Search blob stays empty for protected folios — no leak via LIKE.
    expect(seenByB.data.searchText).toBe("");
  });

  it("resolves cross-author wiki-links via folio_links re-sync on next edit", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const memberB = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Linked notes" } },
      { user: owner },
    );
    await addMember(ctx, memberB.id, created.data.id);

    const targetFolio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Target by B",
          content: "I am the target",
        },
      },
      { user: memberB },
    );

    const sourceFolio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Source by owner",
          content: `See [[#${targetFolio.data.shortId}]] for context`,
        },
      },
      { user: owner },
    );

    const links = await ctx.folioController.getLinks.fetch(
      { params: { id: sourceFolio.data.id } },
      { user: memberB },
    );
    expect(links.data.outbound).toContainEqual({
      kind: "folio",
      shortId: targetFolio.data.shortId,
      title: "Target by B",
    });
  });
});
