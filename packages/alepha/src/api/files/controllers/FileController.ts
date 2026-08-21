import { $inject, AlephaError, type FileLike, isFileLike, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import type { MultipartPart } from "alepha/server/multipart";

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
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

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
  /**
   * Uploads a file, taking its bytes as they arrive.
   *
   * `z.stream()` rather than `z.file()`, and it costs the caller nothing: a
   * `FileLike` is re-readable, so declaring one obliges the framework to hold
   * the whole payload before the handler runs — which caps every upload at what
   * fits in memory, and on a Worker that is around 128 MB for the entire
   * isolate.
   *
   * Small uploads lose nothing by it. `FileService` reads up to its own
   * threshold before deciding, so anything short still gets an exact size and a
   * checksum; only what overflows trades those for not being held.
   *
   * The ceiling comes from the `$storage` this is going to — see
   * `StorageMultipartCapProvider`. The bucket arrives in the query string, so
   * it is known before a single byte is read.
   */
  public readonly uploadFile = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["file:create"] })],
    description: "Upload a new file",
    schema: {
      body: z.object({
        file: z.stream(),
      }),
      query: z.object({
        expirationDate: z.datetime().optional(),
        bucket: z.string().optional(),
      }),
      response: fileResourceSchema,
    },
    handler: async ({ body, user, query }) =>
      this.fileService.uploadFile(this.asFile(body.file), {
        user,
        ...query,
      }),
  });

  /**
   * Dresses a streamed part as the `FileLike` the storage layer speaks.
   *
   * Takes a `FileLike` unchanged, because this action is not only reached over
   * HTTP: `$action` can be invoked in process — by a job, a test, an MCP tool —
   * and then the caller hands a file directly, with no multipart anywhere. A
   * conversion that assumed a part would fail exactly there, and only there.
   *
   * `size` stays 0 for a real part — it is not known and must not be guessed.
   * That is the value `FileService` reads to decide whether it can afford to
   * buffer, and a made-up number would send a 200 MB upload down the buffering
   * path.
   */
  protected asFile(input: MultipartPart | FileLike): FileLike {
    if (isFileLike(input)) {
      return input;
    }
    const part = input;
    return {
      name: part.filename ?? "upload",
      type: part.mediaType || "application/octet-stream",
      size: 0,
      lastModified: this.dateTimeProvider.nowMillis(),
      stream: () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of part.data) {
                controller.enqueue(chunk);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }) as never,
      arrayBuffer: async () => {
        throw new AlephaError(
          "a streamed upload is read once — ask FileService, not the part",
        );
      },
      text: async () => {
        throw new AlephaError("a streamed upload is not readable as text");
      },
    };
  }

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
   * Cache-Control is `public, immutable, max-age=1w` so Cloudflare's edge
   * cache and any intermediary proxy can serve subsequent hits without
   * touching the Worker. The split URL prefix (vs `/files/:id`) is what
   * makes this safe: edge cache is URL-keyed, so public and private files
   * live in separate cache lanes.
   *
   * **A week, not a year, and the difference is deletion.** The worker entry
   * consults `caches.default` BEFORE `__alepha.start()`, so a hit never
   * reaches `getFileById` or `assertPublic` — no row lookup, no policy. And
   * nothing invalidates: there is no `cache.delete` and no zone-purge call
   * anywhere, and `caches.default.delete()` would only evict the PoP serving
   * it. So once a body is stored, `max-age` IS the retention floor for a file
   * that has since been deleted, its account closed, or its bucket dropped
   * from `assertPublic`. A year of that on user-uploaded avatars is not a
   * cache, it is a copy nobody can reach to remove.
   *
   * The header was harmless until it became load-bearing: Cloudflare does not
   * store Worker-generated responses, so before the edge cache landed this
   * bound one requesting browser and nothing else.
   *
   * A week costs close to nothing — the expensive case is the cold D1 + R2 +
   * boot path for a first-time visitor, and anything requested at all is
   * requested well inside a week (PoPs evict low-traffic entries by LRU long
   * before that regardless). `immutable` stays: it suppresses revalidation
   * WITHIN the freshness window, it does not extend it.
   */
  public readonly streamPublicFile = $action({
    path: "/public/files/:id",
    group: this.group,
    description: "Download a public file (anonymous, edge-cacheable)",
    use: [
      $etag({
        control: {
          public: true,
          maxAge: [7, "days"],
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
