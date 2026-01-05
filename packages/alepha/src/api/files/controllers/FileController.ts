import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
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

  /**
   * GET /files - Lists files with optional filtering and pagination.
   * Supports filtering by bucket and tags.
   */
  public readonly findFiles = $action({
    path: this.url,
    group: `admin:${this.group}`,
    description: "List files with filtering and pagination",
    schema: {
      query: fileQuerySchema,
      response: t.page(fileResourceSchema),
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
    description: "Delete a file",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: ({ params }) => this.fileService.deleteFile(params.id),
  });

  /**
   * POST /files - Uploads a new file to storage.
   * Creates a database record with metadata and calculates checksum.
   * Optionally specify bucket and expiration date.
   */
  public readonly uploadFile = $action({
    path: this.url,
    group: this.group,
    description: "Upload a new file",
    schema: {
      body: t.object({
        file: t.file(),
      }),
      query: t.object({
        expirationDate: t.optional(t.datetime()),
        bucket: t.optional(t.string()),
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
    description: "Update file metadata",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      body: t.object({
        name: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        expirationDate: t.optional(t.datetime()),
      }),
      response: fileResourceSchema,
    },
    handler: ({ params, body }) => this.fileService.updateFile(params.id, body),
  });

  /**
   * GET /files/:id - Streams/downloads a file by its ID.
   * Returns the file content with appropriate Content-Type header.
   * Cached with ETag support for 1 year (immutable).
   */
  public readonly streamFile = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Download a file",
    cache: {
      etag: true,
      control: {
        public: true,
        maxAge: [1, "year"],
        immutable: true,
      },
    },
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: t.file(),
    },
    handler: async ({ params }) => {
      return await this.fileService.streamFile(params.id);
    },
  });
}
