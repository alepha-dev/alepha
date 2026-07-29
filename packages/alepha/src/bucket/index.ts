import { $module } from "alepha";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./errors/InvalidFileError.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";
export * from "./providers/R2FileStorageProvider.ts";
export * from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Raw blob storage. **Not the application-facing API.**
 *
 * There is no bucket primitive. Declare file storage with `$storage`
 * (`alepha/api/files`), which pairs every blob with a `files` row and so can
 * offer paginated listing, TTL expiry, tags, checksums, creator tracking and
 * HTTP endpoints.
 *
 * Inject `FileStorageProvider` directly only when you need blobs *without* a
 * database — you get `upload` / `download` / `delete` / `deleteMany` /
 * `exists` / `list`, keyed by a container name you manage yourself, and
 * nothing else.
 *
 * All backends treat the container name as a **key prefix inside one bucket**
 * (`{APP_NAME}/{tenantId}/{container}/{fileId}` — the tenant segment appears
 * when a tenant is active) or one directory on disk — never a separate cloud
 * bucket per container.
 *
 * **Providers:** Memory (testing), Local filesystem, S3-compatible
 * (AWS/MinIO), Cloudflare R2.
 *
 * @module alepha.bucket
 */
export const AlephaBucket = $module({
  name: "alepha.bucket",
  services: [FileStorageProvider],
  variants: [
    MemoryFileStorageProvider,
    LocalFileStorageProvider,
    S3FileStorageProvider,
  ],
  register: (alepha) => {
    const useS3 = !!alepha.env.S3_ENDPOINT;
    alepha.with({
      optional: true,
      provide: FileStorageProvider,
      use:
        alepha.isTest() || alepha.isServerless()
          ? MemoryFileStorageProvider
          : useS3
            ? S3FileStorageProvider
            : LocalFileStorageProvider,
    });
  },
});
