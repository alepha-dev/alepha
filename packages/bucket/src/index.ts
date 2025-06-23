import { $inject, Alepha, substitute } from "@alepha/core";
import { BucketDescriptorProvider } from "./providers/BucketDescriptorProvider.ts";
import { FileStorageProvider } from "./providers/FileStorageProvider.ts";
import { LocalFileStorageProvider } from "./providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "./providers/MemoryFileStorageProvider.ts";

export * from "./errors/FileNotFoundError.ts";
export * from "./providers/BucketDescriptorProvider.ts";
export * from "./providers/FileStorageProvider.ts";
export * from "./providers/LocalFileStorageProvider.ts";
export * from "./providers/MemoryFileStorageProvider.ts";

export class BucketModule {
	public readonly name = "alepha/bucket";
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(
			substitute({
				default: true,
				provide: FileStorageProvider,
				use: this.alepha.isTest()
					? MemoryFileStorageProvider
					: LocalFileStorageProvider,
			}),
			BucketDescriptorProvider,
		);
	}
}
