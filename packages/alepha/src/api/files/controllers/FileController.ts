import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { FileAccessProvider } from "../providers/FileAccessProvider.ts";
import { fileQuerySchema } from "../schemas/fileQuerySchema.ts";
import { fileResourceSchema } from "../schemas/fileResourceSchema.ts";
import { FileService } from "../services/FileService.ts";

/**
 * REST API controller for file management operations.
 * Provides endpoints for uploading, downloading, listing, and deleting files.
 */
export class FileController {
  protected readonly url = "/files";
  protected readonly group = "files";
  protected readonly fileService = $inject(FileService);
  protected readonly fileAccess = $inject(FileAccessProvider);

  /**
   * GET /files - Lists files with optional filtering and pagination.
   * Supports filtering by bucket and tags.
   */
  public readonly findFiles = $action({
    path: this.url,
    group: `admin:${this.group}`,
    use: [$secure({ permissions: ["admin:file:read"] })],
    description: "List files with filtering and pagination",
    schema: {
      query: fileQuerySchema,
      response: z.page(fileResourceSchema),
    },
    handler: ({ query }) => this.fileService.findFiles(query),
  });

  /**
   * DELETE /files/:id - Deletes a file from both storage and database.
   * Removes the file from the bucket and cleans up the database record.
   */
  public readonly deleteFile = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: `admin:${this.group}`,
    use: [$secure({ permissions: ["admin:file:delete"] })],
    description: "Delete a file",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: ({ params }) => this.fileService.deleteFile(params.id),
  });

  /**
   * POST /files/delete - Delete many files in one request, batching the
   * underlying bucket calls per bucket (R2/S3 batch where supported).
   */
  public readonly deleteFiles = $action({
    method: "POST",
    path: `${this.url}/delete`,
    group: `admin:${this.group}`,
    use: [$secure({ permissions: ["admin:file:delete"] })],
    description: "Delete many files",
    schema: {
      body: z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.string()),
      }),
    },
    handler: async ({ body }) => {
      const deleted = await this.fileService.deleteFiles(body.ids);
      return { deleted };
    },
  });

  /**
   * POST /files - Uploads a new file to storage.
   * Creates a database record with metadata and calculates checksum.
   * Optionally specify bucket and expiration date.
   */
  public readonly uploadFile = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["file:create"] })],
    description: "Upload a new file",
    schema: {
      body: z.object({
        file: z.file(),
      }),
      query: z.object({
        expirationDate: z.datetime().optional(),
        bucket: z.string().optional(),
      }),
      response: fileResourceSchema,
    },
    handler: async ({ body, user, query }) =>
      this.fileService.uploadFile(body.file, {
        user,
        ...query,
      }),
  });

  /**
   * PATCH /files/:id - Updates file metadata.
   * Allows updating name, tags, and expiration date without modifying file content.
   */
  public readonly updateFile = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: `admin:${this.group}`,
    use: [$secure({ permissions: ["admin:file:update"] })],
    description: "Update file metadata",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      body: z.object({
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
        expirationDate: z.datetime().optional(),
      }),
      response: fileResourceSchema,
    },
    handler: ({ params, body }) => this.fileService.updateFile(params.id, body),
  });

  /**
   * GET /files/:id - Streams/downloads a file by its ID.
   * Returns the file content with appropriate Content-Type header.
   *
   * Authorization is delegated to `FileAccessProvider.assertReadable`. The
   * default policy is creator-only — override the provider via DI to widen
   * access (e.g. avatars, shared attachments). See `FileAccessProvider`.
   *
   * Cache-Control is `private` because the per-user authorization decision
   * cannot be cached by shared proxies/CDNs. Client-side ETag still works.
   */
  public readonly streamFile = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Download a file",
    use: [
      $secure({ permissions: ["file:read"] }),
      $etag({
        control: {
          private: true,
          maxAge: [1, "year"],
          immutable: true,
        },
      }),
    ],
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: z.file(),
    },
    handler: async ({ params, user }) => {
      const file = await this.fileService.getFileById(params.id);
      await this.fileAccess.assertReadable(file, user);
      return await this.fileService.streamFile(file);
    },
  });

  /**
   * GET /public/files/:id - Anonymous, edge-cacheable download.
   *
   * Authorization is delegated to `FileAccessProvider.assertPublic`. The
   * default policy is deny-all (throws `NotFoundError`), so consuming apps
   * must override the provider to opt files in — typically by bucket name
   * (avatars, campaign icons, etc.).
   *
   * Cache-Control is `public, immutable, max-age=1y` so Cloudflare's edge
   * cache and any intermediary proxy can serve subsequent hits without
   * touching the Worker. The split URL prefix (vs `/files/:id`) is what
   * makes this safe: edge cache is URL-keyed, so public and private files
   * live in separate cache lanes.
   */
  public readonly streamPublicFile = $action({
    path: "/public/files/:id",
    group: this.group,
    description: "Download a public file (anonymous, edge-cacheable)",
    use: [
      $etag({
        control: {
          public: true,
          maxAge: [1, "year"],
          immutable: true,
        },
      }),
    ],
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: z.file(),
    },
    handler: async ({ params }) => {
      const file = await this.fileService.getFileById(params.id);
      await this.fileAccess.assertPublic(file);
      return await this.fileService.streamFile(file);
    },
  });
}
