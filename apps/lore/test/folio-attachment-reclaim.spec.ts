import { Alepha, z } from "alepha";
import { files } from "alepha/api/files";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioAttachmentController } from "../src/api/controllers/FolioAttachmentController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { folioAttachments } from "../src/api/entities/folioAttachments.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Nothing reclaims what a deleted attachment leaves behind, and the entity's
 * own comments said something else.
 *
 * `folio_blobs.fileId` was documented as a foreign key to `files` cascading
 * both ways. It is neither, so deleting an attachment left the overlay row
 * pointing at a file that no longer existed, and deleting a folio cascaded
 * the overlay rows away while the framework files and their bytes stayed in
 * the bucket forever - paid for and unreachable.
 *
 * The constraint is not added: it needs a table rebuild, and a rebuild on D1
 * is the cascade-wipe that cost this app production once. The service is the
 * enforcement, so this is where it has to be proven.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class TestRows {
  public readonly files = $repository(files);
  public readonly attachments = $repository(folioAttachments);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
  directoryController: DirectoryController;
  attachmentController: FolioAttachmentController;
  rows: TestRows;
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
  alepha.with(TestRows);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
    directoryController: alepha.inject(DirectoryController),
    attachmentController: alepha.inject(FolioAttachmentController),
    rows: alepha.inject(TestRows),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const uploadedFile = async (
  ctx: TestContext,
  user: { id: string },
  name: string,
): Promise<string> => {
  const row = await ctx.rows.files.create({
    bucket: "archive-blobs",
    blobId: `attachment-${name}-${crypto.randomUUID()}`,
    name,
    originalName: name,
    mimeType: "image/webp",
    size: 1234,
    creator: user.id,
  });
  return row.id;
};

describe("folio attachment reclamation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A folio, one directory to hang it under, and one attachment on it.
   */
  const aFolioWithAnAttachment = async (title: string) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title } },
      { user: owner },
    );
    const directory = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: project.data.id }, body: { name: "Assets" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          title: "Notes",
          content: "",
          projectId: project.data.id,
          directoryId: directory.data.id,
        },
      },
      { user: owner },
    );
    const fileId = await uploadedFile(ctx, owner, "photo.webp");
    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: { fileId, name: "photo.webp", folioId: folio.data.id },
      },
      { user: owner },
    );
    return { owner, project, directory, folio, fileId };
  };

  const fileExists = async (fileId: string) =>
    (await ctx.rows.files.findOne({ where: { id: { eq: fileId } } })) !==
    undefined;

  const blobExists = async (fileId: string) =>
    (await ctx.rows.attachments.findOne({
      where: { fileId: { eq: fileId } },
    })) !== undefined;

  it("deleting an attachment removes both its rows", async ({ expect }) => {
    const { owner, fileId } = await aFolioWithAnAttachment("Blob");

    await ctx.attachmentController.deleteAttachment.fetch(
      { params: { id: fileId } },
      { user: owner },
    );

    // The overlay used to survive, pointing at nothing.
    expect(await blobExists(fileId)).toBe(false);
    expect(await fileExists(fileId)).toBe(false);
  });

  it("deleting a folio reclaims its attachments' files", async ({ expect }) => {
    const { owner, folio, fileId } = await aFolioWithAnAttachment("Folio");

    await ctx.folioController.delete.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    // The overlay went with the folio either way - the FK cascades. The file
    // row and its bytes are what nothing reclaimed.
    expect(await blobExists(fileId)).toBe(false);
    expect(await fileExists(fileId)).toBe(false);
  });

  it("deleting a directory reclaims the attachments below it", async ({
    expect,
  }) => {
    const { owner, directory, fileId } =
      await aFolioWithAnAttachment("Directory");

    await ctx.directoryController.deleteDirectory.fetch(
      { params: { id: directory.data.id }, query: { cascade: true } },
      { user: owner },
    );

    // The same leak one level up: the directory cascades to the folio, which
    // cascades to the overlay, and the file is left behind by both.
    expect(await blobExists(fileId)).toBe(false);
    expect(await fileExists(fileId)).toBe(false);
  });

  it("leaves a sibling folio's attachments alone", async ({ expect }) => {
    const { owner, project, folio } = await aFolioWithAnAttachment("Siblings");
    const other = await ctx.folioController.create.fetch(
      { body: { title: "Other", content: "", projectId: project.data.id } },
      { user: owner },
    );
    const keptFileId = await uploadedFile(ctx, owner, "kept.webp");
    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: { fileId: keptFileId, name: "kept.webp", folioId: other.data.id },
      },
      { user: owner },
    );

    await ctx.folioController.delete.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    expect(await blobExists(keptFileId)).toBe(true);
    expect(await fileExists(keptFileId)).toBe(true);
  });
});
