import { AlephaBucket, FileStorageProvider } from "@alepha/bucket";
import { $module } from "@alepha/core";
import { AzureFileStorageProvider } from "./providers/AzureFileStorageProvider.ts";

export * from "./providers/AzureFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.
 *
 * @see {@link AzureFileStorageProvider}
 * @module alepha.bucket.azure
 */
export const AlephaBucketAzure = $module({
  name: "alepha.bucket.azure",
  services: [AzureFileStorageProvider],
  register: (alepha) =>
    alepha
      .with({
        optional: true,
        provide: FileStorageProvider,
        use: AzureFileStorageProvider,
      })
      .with(AlephaBucket),
});
