import { $module } from "alepha";
import { AlephaBucket, FileStorageProvider } from "alepha/bucket";
import { S3FileStorageProvider } from "./providers/S3FileStorageProvider.ts";

export * from "./providers/S3FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Bucket that provides S3-compatible storage capabilities.
 *
 * Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.
 *
 * @see {@link S3FileStorageProvider}
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
