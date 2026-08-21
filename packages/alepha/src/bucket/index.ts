import { $module, z } from "alepha";

import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import {
  LocalFileStorageProvider,
  localFileStorageOptions,
} from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/FileNotFoundError.ts";
export * from "./errors/FileTooLargeError.ts";
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
 * database - you get `upload` / `download` / `delete` / `deleteMany` /
 * `exists` / `list`, keyed by a container name you manage yourself, and
 * nothing else.
 *
 * All backends treat the container name as a **key prefix inside one bucket**
 * (`{prefix}/{tenantId}/{container}/{fileId}` - the leading prefix comes from
 * `S3_KEY_PREFIX`, or `APP_NAME` as a fallback, and the tenant segment appears
 * when a tenant is active) or one directory on disk - never a separate cloud
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
    const env = alepha.parseEnv(envSchema);
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

    // Let the host decide where local blobs live, the same way `DATABASE_URL`
    // lets it decide where the database lives.
    //
    // Without this the default (`node_modules/.alepha/buckets`) sits inside the
    // deployed bundle, so a self-hosted platform that unpacks each release into
    // its own directory silently destroys every uploaded file on redeploy.
    const blobPath =
      env.STORAGE_PATH || (env.DATA_DIR ? `${env.DATA_DIR}/buckets` : "");
    if (blobPath) {
      alepha.store.set(localFileStorageOptions.key, { storagePath: blobPath });
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  /**
   * Root directory for local scratch data shared across modules.
   *
   * The defaults of the local providers live under `node_modules/.alepha`, i.e.
   * inside the deployed bundle. Any host that unpacks each release into its own
   * directory therefore loses that data on redeploy — set this to a writable
   * path outside the bundle.
   *
   * @example
   * DATA_DIR=/var/lib/myapp/scratch
   */
  DATA_DIR: z.text({
    default: "",
    secret: false,
    description:
      "Root directory for local scratch data. Blobs land in <DATA_DIR>/buckets unless STORAGE_PATH is set explicitly.",
  }),

  /**
   * Directory where the local file storage provider keeps blobs.
   *
   * Takes precedence over `DATA_DIR`. Only used when no `S3_ENDPOINT` is set,
   * which selects the S3 provider instead.
   *
   * @example
   * STORAGE_PATH=/var/lib/myapp/storage
   */
  STORAGE_PATH: z.text({
    default: "",
    secret: false,
    description:
      "Directory where the local file storage provider keeps blobs. Must live outside the deployed bundle to survive a redeploy. Ignored when S3_ENDPOINT is set.",
  }),
});
