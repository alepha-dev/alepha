import { $module, type FileLike } from "alepha";
import {
  $bucket,
  type BucketFileOptions,
  type BucketPrimitive,
} from "./primitives/$bucket.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./primitives/$bucket.ts";
export * from "./providers/CloudflareR2Provider.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Triggered when a file is uploaded to a bucket.
     * Can be used to perform actions after a file is uploaded, like creating a database record!
     */
    "bucket:file:uploaded": {
      id: string;
      file: FileLike;
      bucket: BucketPrimitive;
      options: BucketFileOptions;
    };
    /**
     * Triggered when a file is deleted from a bucket.
     */
    "bucket:file:deleted": {
      id: string;
      bucket: BucketPrimitive;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.9.0 | node, bun, workerd|
 *
 * Unified file storage abstraction across multiple backends.
 *
 * **Features:**
 * - File storage buckets with constraints
 * - Unified API across all storage backends
 * - MIME type validation
 * - File size limits
 * - Upload/download/delete operations
 * - TTL-based file expiration
 * - Providers: Memory (testing), Local filesystem, AWS S3 / Cloudflare R2 / MinIO, Azure Blob Storage, Vercel Blob
 *
 * @module alepha.bucket
 */
export const AlephaBucket = $module({
  name: "alepha.bucket",
  primitives: [$bucket],
  services: [
    FileStorageProvider,
    MemoryFileStorageProvider,
    LocalFileStorageProvider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: FileStorageProvider,
      use:
        alepha.isTest() || alepha.isServerless()
          ? MemoryFileStorageProvider
          : LocalFileStorageProvider,
    });
  },
});
