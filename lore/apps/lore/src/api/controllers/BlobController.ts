import { $inject, z } from "alepha";
import { FileController, files } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { archiveBlobs } from "../entities/archiveBlobs.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  ARCHIVE_BLOB_BUCKET_NAME,
  ArchiveBlobService,
} from "../services/ArchiveBlobService.ts";

const hydratedBlobSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  campaignId: z.integer(),
  directoryId: z.uuid().optional(),
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
 * REST surface for Archive blobs. The framework `FileController`
 * handles the byte-level upload/download via its own endpoints; this
 * controller layers the Archive concerns on top (campaign + directory
 * placement, sibling name uniqueness, rename/move/delete with bucket
 * cleanup).
 *
 * Typical client flow:
 *   1. POST `/api/files/upload` (framework) → returns framework file id.
 *   2. POST `/api/archive/blobs` (this controller, `register`) → places
 *      the file in the Archive tree with a unique name.
 *   3. GET `/api/files/:id/download-url` (framework) when serving.
 */
export class BlobController {
  protected readonly blobs = $repository(archiveBlobs);
  protected readonly frameworkFiles = $repository(files);
  protected readonly blobService = $inject(ArchiveBlobService);
  protected readonly fileController = $inject(FileController);
  protected readonly security = $inject(AppSecurityProvider);

  /**
   * Bucket for Archive blobs. Registered here so the framework's
   * `FileService.uploadFile` recognises `?bucket=archive-blobs` —
   * without this declaration, every Archive upload 404s with
   * "Bucket 'archive-blobs' not found." Any logged-in user with
   * `file:create` can upload; per-campaign membership is enforced
   * downstream by the `registerBlob` action below.
   */
  archiveBucket = $bucket({
    name: ARCHIVE_BLOB_BUCKET_NAME,
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
      campaignId: blob.campaignId,
      directoryId: blob.directoryId,
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
   * Look up an archive blob by per-campaign shortId. Member-only.
   * Used by the MCP `blob_*` tools to resolve `blob_shortId` params.
   * Returns the hydrated shape so callers don't need a follow-up
   * `getBlob` call.
   */
  getBlobByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/campaigns/:campaignId/archive/blobs/by-short-id/:shortId",
    description: "Look up an archive blob by per-campaign shortId.",
    schema: {
      params: z.object({
        campaignId: z.integer(),
        shortId: z.integer(),
      }),
      response: hydratedBlobSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const blob = await this.blobService.findByShortId(
        params.campaignId,
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
    path: "/campaigns/:campaignId/archive/blobs",
    description: "List blobs in a campaign (optionally filtered by directory).",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      query: z.object({
        directoryId: z.uuid().optional(),
      }),
      response: z.array(hydratedBlobSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const blobs = await this.blobService.listInDirectory(
        params.campaignId,
        query.directoryId,
      );
      const hydrated = await Promise.all(
        blobs.map((b) => this.hydrate(b.fileId)),
      );
      return hydrated.filter((x) => x !== undefined);
    },
  });

  getBlob = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/archive/blobs/:id",
    description:
      "Get a single archive blob (metadata only — use framework download for bytes).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: hydratedBlobSchema,
    },
    handler: async ({ params, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.campaignId, user);
      const hydrated = await this.hydrate(params.id);
      if (!hydrated) throw new NotFoundError("Blob not found");
      return hydrated;
    },
  });

  registerBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/campaigns/:campaignId/archive/blobs",
    description:
      "Register an Archive blob on top of an already-uploaded framework file.",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      body: z.object({
        fileId: z.uuid(),
        name: z.string().min(1).max(200),
        directoryId: z.uuid().optional(),
      }),
      response: archiveBlobs.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.campaignId, user);
      return this.blobService.register({
        campaignId: params.campaignId,
        directoryId: body.directoryId,
        name: body.name,
        fileId: body.fileId,
      });
    },
  });

  renameBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/blobs/:id/rename",
    description: "Rename an archive blob.",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1).max(200) }),
      response: archiveBlobs.schema,
    },
    handler: async ({ params, body, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.campaignId, user);
      return this.blobService.rename(params.id, body.name);
    },
  });

  moveBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/blobs/:id/move",
    description: "Move an archive blob to a new directory (or to root).",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ directoryId: z.uuid().optional() }),
      response: archiveBlobs.schema,
    },
    handler: async ({ params, body, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.campaignId, user);
      return this.blobService.move(params.id, body.directoryId);
    },
  });

  deleteBlob = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/blobs/:id",
    description: "Delete an archive blob (and reclaim framework storage).",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const blob = await this.blobService.findById(params.id);
      if (!blob) throw new NotFoundError("Blob not found");
      await this.security.assertMember(blob.campaignId, user);
      await this.blobService.delete(params.id);
      return { ok: true };
    },
  });
}
