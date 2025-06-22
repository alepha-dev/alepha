import { $inject, Alepha, substitute } from "@alepha/core";
import { BucketDescriptorProvider } from "./providers/BucketDescriptorProvider.ts";
import { DefaultFileStorageProvider } from "./providers/DefaultFileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

export class BucketModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(
			substitute({
				default: true,
				provide: DefaultFileStorageProvider,
				use: this.alepha.isTest()
					? MemoryFileStorageProvider
					: LocalFileStorageProvider,
			}),
		);
		this.alepha.with(BucketDescriptorProvider);
	}
}
