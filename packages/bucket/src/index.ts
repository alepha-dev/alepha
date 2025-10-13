import { $module, type FileLike } from "@alepha/core";
import {
	$bucket,
	type BucketDescriptor,
	type BucketFileOptions,
} from "./descriptors/$bucket.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";
import { FileMetadataService } from "./services/FileMetadataService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$bucket.ts";
export * from "./errors/FileNotFoundError.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";
export * from "./services/FileMetadataService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	interface Hooks {
		/**
		 * Triggered when a file is uploaded to a bucket.
		 * Can be used to perform actions after a file is uploaded, like creating a database record!
		 */
		"bucket:file:uploaded": {
			id: string;
			file: FileLike;
			bucket: BucketDescriptor;
			options: BucketFileOptions;
		};
		/**
		 * Triggered when a file is deleted from a bucket.
		 */
		"bucket:file:deleted": {
			id: string;
			bucket: BucketDescriptor;
		};
	}
}

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
		FileMetadataService,
	],
	register: (alepha) =>
		alepha.with({
			optional: true,
			provide: FileStorageProvider,
			use: alepha.isTest()
				? MemoryFileStorageProvider
				: LocalFileStorageProvider,
		}),
});
