import { $module } from "alepha";
import { AlephaBucket, FileStorageProvider } from "alepha/bucket";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

export * from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * S3-compatible file storage provider.
 *
 * **Features:**
 * - AWS S3 compatibility
 * - Cloudflare R2 compatibility
 * - MinIO compatibility
 * - DigitalOcean Spaces compatibility
 * - Any S3-compatible backend
 *
 * @module alepha.bucket.s3
 */
export const AlephaBucketS3 = $module({
  name: "alepha.bucket.s3",
  services: [S3FileStorageProvider],
  register: (alepha) =>
    alepha
      .with({
        optional: true,
        provide: FileStorageProvider,
        use: S3FileStorageProvider,
      })
      .with(AlephaBucket),
});
