import { $inject, z } from "alepha";
import { $storage, FileController, files } from "alepha/api/files";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { folioBlobs } from "../entities/folioBlobs.ts";
import { folios } from "../entities/folios.ts";
import {
  FOLIO_BLOB_BUCKET_NAME,
  FolioBlobService,
} from "../services/FolioBlobService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

const hydratedBlobSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  projectId: z.integer(),
  folioId: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  size: z.number(),
  mimeType: z.string(),
  sha256: z.string().optional(),
  originalName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * REST surface for Folio blobs. The framework `FileController`
 * handles the byte-level upload/download via its own endpoints; this
 * controller layers the Folio concerns on top (project + directory
 * placement, sibling name uniqueness, rename/move/delete with bucket
 * cleanup).
 *
 * Typical client flow:
 *   1. POST `/api/files/upload` (framework) → returns framework file id.
 *   2. POST `/api/folio/blobs` (this controller, `register`) → places
 *      the file in the Folio tree with a unique name.
 *   3. GET `/api/files/:id/download-url` (framework) when serving.
 */
export class BlobController {
  protected readonly blobs = $repository(folioBlobs);
  protected readonly folioRows = $repository(folios);
  protected readonly frameworkFiles = $repository(files);
  protected readonly blobService = $inject(FolioBlobService);
  protected readonly fileController = $inject(FileController);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Storage for Folio blobs. Declared here so `?bucket=archive-blobs`
   * resolves — without it every Folio upload 404s with
   * "Storage 'archive-blobs' not found." (Bucket value kept as
   * `archive-blobs`, not renamed — see the note on `FOLIO_BLOB_BUCKET`
   * in `FolioBlobService.ts`.) Any logged-in user with `file:create`
   * can upload; per-project membership is enforced downstream by the
   * `registerBlob` action below.
   */
  folioBucket = $storage({
    name: FOLIO_BLOB_BUCKET_NAME,
    description: "Folio blobs",
  });

  /**
   * Hydrate a blob row with framework-file metadata (size, mimeType,
   * checksum/sha256, originalName). Used by GET responses.
   */
  protected async hydrate(fileId: string) {
    const [blob, file] = await Promise.all([
      this.blobService.findById(fileId),
      this.frameworkFiles.findOne({ where: { id: { eq: fileId } } }),
    ]);
    if (!blob || !file) return undefined;
    return {
      id: blob.fileId,
      shortId: blob.shortId,
      projectId: blob.projectId,
      folioId: blob.folioId,
      name: blob.name,
      createdAt: blob.createdAt,
      updatedAt: blob.updatedAt,
      size: file.size,
      mimeType: file.mimeType,
      sha256: file.checksum,
      originalName: file.originalName,
      tags: file.tags,
    };
  }

  /**
   * Look up a folio blob by per-project shortId. Member-only.
   * Used by the MCP `blob_*` tools to resolve `blob_shortId` params.
   * Returns the hydrated shape so callers don't need a follow-up
   * `getBlob` call.
   */
  getBlobByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/projects/:projectId/folio/blobs/by-short-id/:shortId",
    description: "Look up a folio blob by per-project shortId.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      response: hydratedBlobSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      const blob = await this.blobService.findByShortId(
        params.projectId,
        params.shortId,
      );
      if (!blob) throw new NotFoundError("Blob not found");
      const hydrated = await this.hydrate(blob.fileId);
      if (!hydrated) throw new NotFoundError("Blob not found");
      return hydrated;
    },
  });

  listBlobs = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/folios/:folioId/blobs",
    description: "List the attachments of one folio.",
    schema: {
      params: z.object({ folioId: z.uuid() }),
      response: z.array(hydratedBlobSchema),
    },
    handler: async ({ params, user }) => {
      const folio = await this.folioRows.findOne({
        where: { id: { eq: params.folioId } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      await this.security.assertMember(folio.projectId, user);
      const blobs = await this.blobService.listByFolio(params.folioId);
      const hydrated = await Promise.all(
        blobs.map((b) => this.hydrate(b.fileId)),
      );
      return hydrated.filter((x) => x !== undefined);
    },
  });

  getBlob = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/folio/blobs/:id",
    description:
      "Get a single folio blob (metadata only — use framework download for bytes).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: hydratedBlobSchema,
    },
    handler: async ({ params, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.projectId, user);
      const hydrated = await this.hydrate(params.id);
      if (!hydrated) throw new NotFoundError("Blob not found");
      return hydrated;
    },
  });

  registerBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/projects/:projectId/folio/blobs",
    description:
      "Register a folio blob on top of an already-uploaded framework file.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        fileId: z.uuid(),
        name: z.string().min(1).max(200),
        folioId: z.uuid(),
      }),
      response: folioBlobs.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.projectId, user);
      return this.blobService.register({
        projectId: params.projectId,
        folioId: body.folioId,
        name: body.name,
        fileId: body.fileId,
      });
    },
  });

  renameBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folio/blobs/:id/rename",
    description: "Rename a folio blob.",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1).max(200) }),
      response: folioBlobs.schema,
    },
    handler: async ({ params, body, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.projectId, user);
      return this.blobService.rename(params.id, body.name);
    },
  });

  deleteBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folio/blobs/:id",
    description: "Delete a folio blob (and reclaim framework storage).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.projectId, user);
      await this.blobService.delete(params.id);
      return { ok: true };
    },
  });
}
