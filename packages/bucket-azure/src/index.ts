import { BucketModule, FileStorageProvider } from "@alepha/bucket";
import { $inject, Alepha, type Module } from "@alepha/core";
import { AzureFileStorageProvider } from "./providers/AzureFileStorageProvider.ts";

export * from "./providers/AzureFileStorageProvider.ts";

export class AzureBucketModule implements Module {
	public readonly name = "alepha/bucket/azure";

	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(
			{
				default: true,
				provide: FileStorageProvider,
				use: AzureFileStorageProvider,
			},
			BucketModule,
		);
	}
}
