import { $module } from "@alepha/core";
import { $bucket } from "./descriptors/$bucket.ts";
import { BucketDescriptorProvider } from "./providers/BucketDescriptorProvider.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$bucket.ts";
export * from "./errors/FileNotFoundError.ts";
export * from "./providers/BucketDescriptorProvider.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides file storage capabilities through declarative bucket descriptors with support for multiple storage backends.
 *
 * The bucket module enables unified file operations across different storage systems using the `$bucket` descriptor
 * on class properties. It abstracts storage provider differences, offering consistent APIs for local filesystem,
 * cloud storage, or in-memory storage for testing environments.
 *
 * @see {@link $bucket}
 * @see {@link FileStorageProvider}
 * @module alepha.bucket
 */
export const AlephaBucket = $module({
	name: "alepha.bucket",
	descriptors: [$bucket],
	services: [
		FileStorageProvider,
		MemoryFileStorageProvider,
		LocalFileStorageProvider,
		BucketDescriptorProvider,
	],
	register: (alepha) =>
		alepha
			.with({
				optional: true,
				provide: FileStorageProvider,
				use: alepha.isTest()
					? MemoryFileStorageProvider
					: LocalFileStorageProvider,
			})
			.with(BucketDescriptorProvider),
});
