import { $module, type FileLike } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaBucket } from "alepha/bucket";
import { AlephaServerEtag } from "alepha/server/etag";
import { AdminFileStatsController } from "./controllers/AdminFileStatsController.ts";
import { FileController } from "./controllers/FileController.ts";
import { FileJobs } from "./jobs/FileJobs.ts";
import { $storage, type StoragePrimitive } from "./primitives/$storage.ts";
import { DefaultStorage } from "./providers/DefaultStorage.ts";
import { FileAccessProvider } from "./providers/FileAccessProvider.ts";
import { StorageMultipartCapProvider } from "./providers/StorageMultipartCapProvider.ts";
import { FileService } from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * The bytes are in hand, the storage's own MIME and size rules have
     * passed, and nothing has been written yet. A subscriber may **replace**
     * `ev.file` — what it puts there is what gets hashed, stored and described
     * by the `files` row.
     *
     * The seam that keeps upload-time concerns out of core — resizing,
     * re-encoding, EXIF stripping, scanning. Each of those drags in a
     * dependency that has no business in the bundle of an app that merely
     * stores a PDF, so core offers the hook and carries none of them.
     *
     * **No subscriber ships with the framework today.** A server-side image
     * resizer built on this was measured and dropped: the wasm codec cost 27%
     * of a Cloudflare Worker's entire byte budget, loaded on every request
     * rather than every upload, to cover the uploads a browser-side downscale
     * (`ControlUpload`'s `image` prop) already handles — and encoded them
     * worse, having no lossy WebP. Reach for this hook where that trade comes
     * out differently: a Node host with no bundle ceiling, or a transform with
     * no client-side equivalent.
     *
     * Fires only for uploads small enough to be buffered
     * (`FileService.BUFFER_THRESHOLD`, 10 MB). Larger ones stream straight to
     * the backend and are never materialised, so there is nothing to hand a
     * subscriber.
     */
    "files:beforeUpload": FileUploadEvent;
  }
}

export interface FileUploadEvent {
  /**
   * Reassign to store something else — resized, re-encoded, stripped of
   * metadata. Leave alone to store what the caller sent.
   */
  file: FileLike;

  /**
   * Where it is headed. Read `storage.options` for whatever option your
   * package augmented `StoragePrimitiveOptions` with.
   */
  storage: StoragePrimitive;
}

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminFileStatsController.ts";
export * from "./controllers/FileController.ts";
export * from "./entities/files.ts";
export * from "./jobs/FileJobs.ts";
export * from "./primitives/$storage.ts";
export * from "./providers/DefaultStorage.ts";
export * from "./providers/FileAccessProvider.ts";
export * from "./providers/StorageMultipartCapProvider.ts";
export * from "./schemas/fileCreatorSummarySchema.ts";
export * from "./schemas/fileQuerySchema.ts";
export * from "./schemas/fileResourceSchema.ts";
export * from "./schemas/storageStatsSchema.ts";
export * from "./services/FileService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * File storage with metadata: the `$storage` primitive plus the endpoints,
 * querying and retention that a database makes possible.
 *
 * Declare a place to keep files with `$storage`. Every upload writes a `files`
 * row next to the blob, which is what powers paginated listing, TTL expiry,
 * tags, checksums and creator tracking.
 *
 * ```ts
 * class Media {
 *   avatars = $storage({ mimeTypes: ["image/png"], maxSize: 2 });
 * }
 *
 * const stored = await this.avatars.upload(file, { user });
 * stored.id; // hand this to GET /api/files/:id
 * ```
 *
 * **Features:**
 * - `$storage` primitive with MIME/size constraints and default TTL
 * - Upload/download HTTP endpoints, ETag-aware
 * - Paginated, filterable file queries
 * - TTL-based expiration swept by `api:files:purgeFiles`
 * - Storage statistics for the admin UI
 *
 * Blobs *without* a database are a `FileStorageProvider` concern — see
 * `alepha/bucket`.
 *
 * @module alepha.api.files
 */
export const AlephaApiFiles = $module({
  name: "alepha.api.files",
  primitives: [$storage],
  services: [
    FileController,
    AdminFileStatsController,
    FileJobs,
    FileService,
    FileAccessProvider,
    DefaultStorage,
    // Lets the targeted bucket decide the request's size budget. Without it,
    // `$storage({ maxSize })` could only ever tighten an application-wide
    // ceiling, never reach past it — a bucket asking for 100 MB was silently
    // held at 5, and nothing said so.
    StorageMultipartCapProvider,
  ],

  imports: [AlephaApiJobs, AlephaBucket, AlephaServerEtag],
});
