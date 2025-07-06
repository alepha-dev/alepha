import {
	$hook,
	$inject,
	Alepha,
	type HookDescriptor,
	OPTIONS,
} from "@alepha/core";
import {
	$bucket,
	type BucketDescriptorOptions,
} from "../descriptors/$bucket.ts";

export class BucketDescriptorProvider {
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly buckets: Array<Bucket> = [];

	public readonly onConfigure: HookDescriptor<"configure"> = $hook({
		name: "configure",
		handler: () => {
			const buckets = this.alepha.getDescriptorValues($bucket);
			for (const bucket of buckets) {
				const options = bucket.value[OPTIONS];
				this.buckets.push({
					name: options.name ?? bucket.key,
					options,
				});
			}
		},
	});

	public getBuckets(): Array<Bucket> {
		return this.buckets;
	}
}

export interface Bucket {
	name: string;
	options: BucketDescriptorOptions;
}
