import {
	type FileLike,
	KIND,
	NotImplementedError,
	OPTIONS,
} from "@alepha/core";
import type { FileStorageProvider } from "../providers/FileStorageProvider.ts";

/**
 * Create a container for storing files.
 *
 * @example
 * ```ts
 * import { $bucket } from "@alepha/bucket";
 *
 * class App {
 *   images = $bucket();
 *
 *   uploadImage(file: FileLike): Promise<string> {
 *     return this.images.upload(file);
 *   }
 * }
 * ```
 */
export const $bucket = (options: BucketDescriptorOptions): BucketDescriptor => {
	return {
		[KIND]: "BUCKET",
		[OPTIONS]: options,
		get name(): string {
			throw new NotImplementedError("BUCKET");
		},
		get provider(): FileStorageProvider {
			throw new NotImplementedError("BUCKET");
		},
		upload: async (): Promise<string> => {
			throw new NotImplementedError("BUCKET");
		},
		exists: async (): Promise<boolean> => {
			throw new NotImplementedError("BUCKET");
		},
		download: async (): Promise<FileLike> => {
			throw new NotImplementedError("BUCKET");
		},
		delete: async (): Promise<void> => {
			throw new NotImplementedError("BUCKET");
		},
	};
};

$bucket[KIND] = "BUCKET";

// ---------------------------------------------------------------------------------------------------------------------

export type BucketDescriptorOptions = {
	/**
	 * File storage provider. If not provided, the default provider will be used.
	 */
	provider?: FileStorageProvider;

	/**
	 * Optional name of the bucket. If not provided, the key of the descriptor will be used.
	 */
	name?: string;

	/**
	 * Optional description of the bucket.
	 */
	description?: string;

	/**
	 * Allowed MIME types.
	 */
	mimeTypes?: string[];

	/**
	 * Maximum size of the files in the bucket. Default is 10MB.
	 */
	maxSize?: number;
};

export interface BucketDescriptor {
	[KIND]: "BUCKET";
	[OPTIONS]: BucketDescriptorOptions;

	/**
	 * Name of the bucket.
	 */
	readonly name: string;

	/**
	 * File storage provider.
	 */
	readonly provider: FileStorageProvider;

	/**
	 * Uploads a file to the bucket.
	 */
	upload: (file: FileLike) => Promise<string>;

	/**
	 * Checks if a file exists in the bucket.
	 */
	exists: (fileId: string) => Promise<boolean>;

	/**
	 * Downloads a file from the bucket.
	 */
	download: (fileId: string) => Promise<FileLike>;

	/**
	 * Streams a file from the bucket.
	 */
	delete: (fileId: string) => Promise<void>;
}
