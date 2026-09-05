import { Alepha, z } from "alepha";
import { files } from "alepha/api/files";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioAttachmentController } from "../src/api/controllers/FolioAttachmentController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Direct access to the framework `files` table.
 *
 * A folio attachment is an overlay on a framework file row, and `register` refuses
 * a file that does not already exist in the `archive-blobs` bucket — so a
 * test that wants a attachment has to put the underlying row there first. Going
 * through the real upload endpoint would drag in multipart handling to prove
 * nothing this spec is about.
 */
class TestFiles {
  public readonly rows = $repository(files);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
  attachmentController: FolioAttachmentController;
  testFiles: TestFiles;
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
  alepha.with(TestFiles);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
    attachmentController: alepha.inject(FolioAttachmentController),
    testFiles: alepha.inject(TestFiles),
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
 * Create the framework file row a attachment will overlay, and return its id.
 */
const uploadedFile = async (
  ctx: TestContext,
  user: { id: string },
  name: string,
): Promise<string> => {
  const row = await ctx.testFiles.rows.create({
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

describe("folio attachments are scoped to one folio", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("registers a attachment against the folio that owns it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob scope" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { title: "Notes", content: "", projectId: project.data.id } },
      { user: owner },
    );
    const fileId = await uploadedFile(ctx, owner, "photo.webp");

    const attachment = await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: { fileId, name: "photo.webp", folioId: folio.data.id },
      },
      { user: owner },
    );

    expect(attachment.data.folioId).toBe(folio.data.id);
  });

  it("lists only the attachments of the folio asked for", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob scope list" } },
      { user: owner },
    );
    const first = await ctx.folioController.create.fetch(
      { body: { title: "First", content: "", projectId: project.data.id } },
      { user: owner },
    );
    const second = await ctx.folioController.create.fetch(
      { body: { title: "Second", content: "", projectId: project.data.id } },
      { user: owner },
    );

    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "a.webp"),
          name: "a.webp",
          folioId: first.data.id,
        },
      },
      { user: owner },
    );
    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "b.webp"),
          name: "b.webp",
          folioId: second.data.id,
        },
      },
      { user: owner },
    );

    const listed = await ctx.attachmentController.listAttachments.fetch(
      { params: { folioId: first.data.id } },
      { user: owner },
    );

    expect(listed.data.map((attachment) => attachment.name)).toEqual([
      "a.webp",
    ]);
  });

  it("allows the same attachment name in two different folios", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob scope names" } },
      { user: owner },
    );
    const first = await ctx.folioController.create.fetch(
      { body: { title: "One", content: "", projectId: project.data.id } },
      { user: owner },
    );
    const second = await ctx.folioController.create.fetch(
      { body: { title: "Two", content: "", projectId: project.data.id } },
      { user: owner },
    );

    const a = await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "photo.webp"),
          name: "photo.webp",
          folioId: first.data.id,
        },
      },
      { user: owner },
    );
    const b = await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "photo.webp"),
          name: "photo.webp",
          folioId: second.data.id,
        },
      },
      { user: owner },
    );

    // The folio is the scope now — a directory-scoped namespace would have
    // suffixed the second one to "photo (1).webp".
    expect(a.data.name).toBe("photo.webp");
    expect(b.data.name).toBe("photo.webp");
  });

  it("still auto-suffixes a duplicate name inside one folio", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob scope suffix" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { title: "One", content: "", projectId: project.data.id } },
      { user: owner },
    );

    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "photo.webp"),
          name: "photo.webp",
          folioId: folio.data.id,
        },
      },
      { user: owner },
    );
    const second = await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: {
          fileId: await uploadedFile(ctx, owner, "photo.webp"),
          name: "photo.webp",
          folioId: folio.data.id,
        },
      },
      { user: owner },
    );

    expect(second.data.name).toBe("photo (1).webp");
  });

  it("rewrites assets/ references in the folio when an attachment is renamed", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob rename rewrite" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          title: "Notes",
          projectId: project.data.id,
          content:
            "Intro\n\n![A diagram](assets/photo.webp)\n\nAlso [link](assets/photo.webp).",
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

    await ctx.attachmentController.renameAttachment.fetch(
      { params: { id: fileId }, body: { name: "diagram.webp" } },
      { user: owner },
    );

    const after = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // Both references move, and nothing else in the body is touched.
    expect(after.data.content).toBe(
      "Intro\n\n![A diagram](assets/diagram.webp)\n\nAlso [link](assets/diagram.webp).",
    );
  });

  it("rewrites a reference whose name contains parentheses", async ({
    expect,
  }) => {
    // `autoSuffix` generates exactly this shape on every name collision, and
    // `encodeURIComponent` does NOT encode parentheses — so this is the
    // commonest name in the system and the one most likely to break.
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob paren rename" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          title: "Notes",
          projectId: project.data.id,
          content: "![](assets/shot%20%281%29.png)",
        },
      },
      { user: owner },
    );
    const fileId = await uploadedFile(ctx, owner, "shot (1).png");
    await ctx.attachmentController.registerAttachment.fetch(
      {
        params: { projectId: project.data.id },
        body: { fileId, name: "shot (1).png", folioId: folio.data.id },
      },
      { user: owner },
    );

    await ctx.attachmentController.renameAttachment.fetch(
      { params: { id: fileId }, body: { name: "final shot.png" } },
      { user: owner },
    );

    const after = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(after.data.content).toBe("![](assets/final%20shot.png)");
  });

  it("deletes a folio's attachments along with the folio", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Blob scope cascade" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { title: "Doomed", content: "", projectId: project.data.id } },
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

    await ctx.folioController.delete.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    // Asserted on the attachment itself rather than through `listAttachments`: that
    // endpoint resolves its folio first, so once the folio is gone it answers
    // 404 either way and would pass even if the row had survived.
    await expect(
      ctx.attachmentController.getAttachment.fetch(
        { params: { id: fileId } },
        { user: owner },
      ),
    ).rejects.toThrow(/not found/i);
  });
});
