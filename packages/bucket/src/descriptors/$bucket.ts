import { KIND, OPTIONS } from "@alepha/core";

export type BucketDescriptorOptions = {
	name?: string;
};

export interface BucketDescriptor {
	[KIND]: "BUCKET";
	[OPTIONS]: BucketDescriptorOptions;
}

export const $bucket = (options: BucketDescriptorOptions): BucketDescriptor => {
	return {
		[KIND]: "BUCKET",
		[OPTIONS]: options,
	};
};

$bucket[KIND] = "BUCKET";
