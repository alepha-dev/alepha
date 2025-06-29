import { KIND, OPTIONS } from "@alepha/core";
import type { FileStorageProvider } from "../providers/FileStorageProvider.ts";

/**
 * Store files in a bucket. WIP
 */
export const $bucket = (options: BucketDescriptorOptions): BucketDescriptor => {
	return {
		[KIND]: "BUCKET",
		[OPTIONS]: options,
	};
};

$bucket[KIND] = "BUCKET";

// ---------------------------------------------------------------------------------------------------------------------

export type BucketDescriptorOptions = {
	provider?: FileStorageProvider;
	name?: string;
};

export interface BucketDescriptor {
	[KIND]: "BUCKET";
	[OPTIONS]: BucketDescriptorOptions;
}
