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
 * Provides file storage capabilities through declarative bucket primitives with support for multiple storage backends.
 *
 * The bucket module enables unified file operations across different storage systems using the `$bucket` primitive
 * on class properties. It abstracts storage provider differences, offering consistent APIs for local filesystem,
 * cloud storage, or in-memory storage for testing environments.
 *
 * @see {@link $bucket}
 * @see {@link FileStorageProvider}
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
