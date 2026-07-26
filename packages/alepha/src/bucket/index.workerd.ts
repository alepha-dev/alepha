import { $module } from "alepha";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { R2FileStorageProvider } from "./providers/R2FileStorageProvider.ts";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./errors/InvalidFileError.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";
export * from "./providers/R2FileStorageProvider.ts";
export * from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Raw blob storage on Cloudflare. **Not the application-facing API.**
 *
 * There is no bucket primitive — declare file storage with `$storage`
 * (`alepha/api/files`). Inject `FileStorageProvider` directly only when you
 * need blobs without a database.
 *
 * R2 keys every object as `{APP_NAME}/{container}/{fileId}` inside the single
 * bucket bound as `R2_BUCKET_NAME`.
 *
 * @module alepha.bucket
 */
export const AlephaBucket = $module({
  name: "alepha.bucket",
  services: [
    FileStorageProvider,
    MemoryFileStorageProvider,
    R2FileStorageProvider,
  ],
  variants: [
    MemoryFileStorageProvider,
    R2FileStorageProvider,
    S3FileStorageProvider, // S3 is allowed, it's ok inside workers (s3mini = fetch)
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: FileStorageProvider,
      use: alepha.isTest() ? MemoryFileStorageProvider : R2FileStorageProvider,
    });
  },
});
