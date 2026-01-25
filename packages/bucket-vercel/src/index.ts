import { $module } from "alepha";
import { AlephaBucket, FileStorageProvider } from "alepha/bucket";
import { VercelFileStorageProvider } from "./providers/VercelFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/VercelFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Vercel Blob Storage provider.
 *
 * **Features:**
 * - Serverless-optimized storage
 * - Vercel deployment integration
 *
 * @module alepha.bucket.vercel
 */
export const AlephaBucketVercel = $module({
  name: "alepha.bucket.vercel",
  services: [VercelFileStorageProvider],
  register: (alepha) =>
    alepha
      .with({
        optional: true,
        provide: FileStorageProvider,
        use: VercelFileStorageProvider,
      })
      .with(AlephaBucket),
});
