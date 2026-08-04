import { $module } from "alepha";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { R2FileStorageProvider } from "./providers/R2FileStorageProvider.ts";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./errors/FileTooLargeError.ts";
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
 * **Deploying the direct route:** set `R2_BUCKET_NAME` in `.env.<env>`.
 * `$storage` is a primitive the build can see, so it provisions the bucket
 * and emits the binding automatically; injecting the provider declares
 * nothing, and it cannot be inferred either — the build introspects your
 * app under node, where this module binds Local/Memory/S3, while the R2
 * binding and its hard `R2_BUCKET_NAME` requirement only exist under
 * workerd. Without it the worker builds and uploads, then fails to boot
 * with `SchemaValidationError: 'R2_BUCKET_NAME' is required`. An explicit
 * value also wins over the derived name, so a pre-existing bucket keeps
 * its keys.
 *
 * R2 keys every object as `{APP_NAME}/{tenantId}/{container}/{fileId}` (the
 * tenant segment appears when a tenant is active) inside the single bucket
 * bound as `R2_BUCKET_NAME`.
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
