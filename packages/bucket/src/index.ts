import type { Alepha, Module } from "@alepha/core";
import { BucketDescriptorProvider } from "./providers/BucketDescriptorProvider.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

export * from "./errors/FileNotFoundError.ts";
export * from "./providers/BucketDescriptorProvider.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Bucket Module
 *
 * This module provides file storage capabilities using different storage providers.
 * It includes a default local file storage provider for production and a memory storage provider for testing.
 * It also provides a $bucket() descriptor provider to manage file buckets.
 *
 * @see {@link $bucket}
 * @see {@link FileStorageProvider}
 * @module alepha.bucket
 */
export class AlephaBucket implements Module {
	public readonly name = "alepha.bucket";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with({
				provide: FileStorageProvider,
				use: alepha.isTest()
					? MemoryFileStorageProvider
					: LocalFileStorageProvider,
				optional: true,
			})
			.with(BucketDescriptorProvider);
}
