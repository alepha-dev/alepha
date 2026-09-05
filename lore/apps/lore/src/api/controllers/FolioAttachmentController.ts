import { $inject, z } from "alepha";
import { $storage, FileController, files } from "alepha/api/files";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { folioAttachments } from "../entities/folioAttachments.ts";
import { folios } from "../entities/folios.ts";
import { hydratedFolioAttachmentSchema } from "../schemas/hydratedFolioAttachmentSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { FolioAttachmentService } from "../services/FolioAttachmentService.ts";

/**
 * REST surface for Folio attachments. The framework `FileController`
 * handles the byte-level upload/download via its own endpoints; this
 * controller layers the Folio concerns on top (project + directory
 * placement, sibling name uniqueness, rename/move/delete with bucket
 * cleanup).
 *
 * Typical client flow:
 *   1. POST `/api/files/upload` (framework) → returns framework file id.
 *   2. POST `/api/folio/attachments` (this controller, `register`) → places
 *      the file in the Folio tree with a unique name.
 *   3. GET `/api/files/:id/download-url` (framework) when serving.
 */
export class FolioAttachmentController {
  protected readonly attachments = $repository(folioAttachments);
  protected readonly folioRows = $repository(folios);
  protected readonly frameworkFiles = $repository(files);
  protected readonly attachmentService = $inject(FolioAttachmentService);
  protected readonly fileController = $inject(FileController);

  /**
   * The three gates this controller needs, declared above the actions: a
   * `use: [...]` entry reading another field is a field initializer, so a
   * gate declared below its first use is `undefined` at construction time.
   *
   * ⚠️ There is a SECOND door to the same bytes. `LoreFileAccessProvider`
   * guards `/api/files/:id` against IDOR and has its own regression e2e
   * (`security-file-access.spec.ts`). It is out of scope here, and gating
   * this controller does not cover it.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  /**
   * Member gate on the project the attachment named by `params.id` belongs to.
   *
   * `folio_blobs` is keyed on `fileId`, not `id`, which the gate resolves on
   * its own - `findById` reads the entity's declared primary key rather than
   * assuming a column name.
   */
  protected ownsBlob = () =>
    $ownsProject({ repository: () => this.attachments, param: "id" });

  /**
   * Member gate reached from the FOLIO the attachments hang off, which is
   * what `listAttachments` addresses. A different table from the other five, and
   * the site that proves the hop is not hardcoded to "the row this
   * controller is named after".
   */
  protected ownsFolio = () =>
    $ownsProject({ repository: () => this.folioRows, param: "folioId" });

  /**
   * Storage for Folio attachments. Declared here so `?bucket=archive-blobs`
   * resolves — without it every Folio upload 404s with
   * "Storage 'archive-blobs' not found." (Bucket value kept as
   * `archive-blobs`, not renamed — see the note on
   * `FolioAttachmentService.BUCKET`.) Any logged-in user with `file:create`
   * can upload; per-project membership is enforced downstream by the
   * `registerAttachment` action below.
   */
  folioBucket = $storage({
    name: FolioAttachmentService.BUCKET,
    description: "Folio attachments",
  });

  /**
   * Hydrate a attachment row with framework-file metadata (size, mimeType,
   * checksum/sha256, originalName). Used by GET responses.
   */
  protected async hydrate(fileId: string) {
    const [attachment, file] = await Promise.all([
      this.attachmentService.findById(fileId),
      this.frameworkFiles.findOne({ where: { id: { eq: fileId } } }),
    ]);
    if (!attachment || !file) return undefined;
    return {
      id: attachment.fileId,
      shortId: attachment.shortId,
      projectId: attachment.projectId,
      folioId: attachment.folioId,
      name: attachment.name,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
      size: file.size,
      mimeType: file.mimeType,
      sha256: file.checksum,
      originalName: file.originalName,
      tags: file.tags,
    };
  }

  /**
   * Look up a folio attachment by per-project shortId. Member-only.
   * Used by the MCP `folio_attachment_*` tools to resolve `attachment_shortId` params.
   * Returns the hydrated shape so callers don't need a follow-up
   * `getAttachment` call.
   */
  getAttachmentByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] }), this.ownsProject()],
    path: "/projects/:projectId/folio/attachments/by-short-id/:shortId",
    description: "Look up a folio attachment by per-project shortId.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      response: hydratedFolioAttachmentSchema,
    },
    handler: async ({ params }) => {
      const attachment = await this.attachmentService.findByShortId(
        params.projectId,
        params.shortId,
      );
      if (!attachment) throw new NotFoundError("Blob not found");
      const hydrated = await this.hydrate(attachment.fileId);
      if (!hydrated) throw new NotFoundError("Blob not found");
      return hydrated;
    },
  });

  listAttachments = $action({
    use: [$secure({ permissions: ["folio:read"] }), this.ownsFolio()],
    path: "/folios/:folioId/attachments",
    description: "List the attachments of one folio.",
    schema: {
      params: z.object({ folioId: z.uuid() }),
      response: z.array(hydratedFolioAttachmentSchema),
    },
    handler: async ({ params }) => {
      return this.attachmentService.listHydratedByFolio(params.folioId);
    },
  });

  getAttachment = $action({
    use: [$secure({ permissions: ["folio:read"] }), this.ownsBlob()],
    path: "/folio/attachments/:id",
    description:
      "Get a single folio attachment (metadata only — use framework download for bytes).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: hydratedFolioAttachmentSchema,
    },
    handler: async ({ params }) => {
      const hydrated = await this.hydrate(params.id);
      if (!hydrated) throw new NotFoundError("Blob not found");
      return hydrated;
    },
  });

  registerAttachment = $action({
    // Gate INSIDE the transaction, not ahead of it - see `$ownsProject`.
    use: [
      $secure({ permissions: ["folio:write"] }),
      $transactional(),
      this.ownsProject(),
    ],
    path: "/projects/:projectId/folio/attachments",
    description:
      "Register a folio attachment on top of an already-uploaded framework file.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        fileId: z.uuid(),
        name: z.string().min(1).max(200),
        folioId: z.uuid(),
      }),
      response: folioAttachments.schema,
    },
    handler: async ({ params, body }) => {
      return this.attachmentService.register({
        projectId: params.projectId,
        folioId: body.folioId,
        name: body.name,
        fileId: body.fileId,
      });
    },
  });

  renameAttachment = $action({
    // Gate INSIDE the transaction - see `$ownsProject`.
    use: [
      $secure({ permissions: ["folio:write"] }),
      $transactional(),
      this.ownsBlob(),
    ],
    path: "/folio/attachments/:id/rename",
    description: "Rename a folio attachment.",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1).max(200) }),
      response: folioAttachments.schema,
    },
    handler: async ({ params, body }) => {
      return this.attachmentService.rename(params.id, body.name);
    },
  });

  deleteAttachment = $action({
    // Gate INSIDE the transaction - see `$ownsProject`.
    use: [
      $secure({ permissions: ["folio:write"] }),
      $transactional(),
      this.ownsBlob(),
    ],
    path: "/folio/attachments/:id",
    description: "Delete a folio attachment (and reclaim framework storage).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.attachmentService.delete(params.id);
      return { ok: true };
    },
  });
}
