import { AlephaBucket, FileStorageProvider } from "@alepha/bucket";
import type { Alepha, Module } from "@alepha/core";
import { AzureFileStorageProvider } from "./providers/AzureFileStorageProvider.ts";

export * from "./providers/AzureFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.
 *
 * @see {@link AzureFileStorageProvider}
 * @module alepha.bucket.azure
 */
export class AlephaBucketAzure implements Module {
	public readonly name = "alepha.bucket.azure";
	public readonly $services = (alepha: Alepha): void => {
		alepha
			.with({
				provide: FileStorageProvider,
				use: AzureFileStorageProvider,
				optional: true,
			})
			.with(AlephaBucket);
	};
}
