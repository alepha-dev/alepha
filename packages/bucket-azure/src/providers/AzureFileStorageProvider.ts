import { randomUUID } from "node:crypto";
import {
	BucketDescriptorProvider,
	FileNotFoundError,
	type FileStorageProvider,
} from "@alepha/bucket";
import type { Static } from "@alepha/core";
import { $env, $hook, $inject, $logger, type FileLike, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { file } from "@alepha/file";
import {
	BlobServiceClient,
	type BlockBlobClient,
	type ContainerClient,
	type StoragePipelineOptions,
} from "@azure/storage-blob";

const envSchema = t.object({
	AZ_STORAGE_CONNECTION_STRING: t.string({
		size: "long",
		default:
			"DefaultEndpointsProtocol=http;" +
			"AccountName=devstoreaccount1;" +
			"AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
			"BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class AzureFileStorageProvider implements FileStorageProvider {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly bucketProvider = $inject(BucketDescriptorProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly containers: Record<string, ContainerClient> = {};
	protected readonly blobServiceClient: BlobServiceClient;
	protected readonly options: StoragePipelineOptions = {};

	constructor() {
		this.blobServiceClient = BlobServiceClient.fromConnectionString(
			this.env.AZ_STORAGE_CONNECTION_STRING,
			this.storagePipelineOptions(),
		);
	}

	public storagePipelineOptions(): StoragePipelineOptions {
		return {};
	}

	public async createContainer(
		containerName: string,
	): Promise<ContainerClient> {
		if (this.containers[containerName]) {
			return this.containers[containerName];
		}
		const container = await this.createContainerClient(containerName);
		this.containers[containerName] = container;
		return container;
	}

	public async upload(
		bucketName: string,
		file: FileLike,
		fileId?: string,
	): Promise<string> {
		fileId ??= this.createId();
		const block = this.getBlock(bucketName, fileId);

		const metadata = {
			name: file.name,
			type: file.type,
		};

		if (file.filepath) {
			await block.uploadFile(file.filepath, {
				metadata,
				blobHTTPHeaders: {
					blobContentType: file.type,
				},
			});
		} else if (file.size > 0) {
			await block.uploadData(await file.arrayBuffer(), {
				metadata,
				blobHTTPHeaders: {
					blobContentType: file.type,
				},
			});
		} else {
			throw new Error("Raw stream upload is not supported yet");
		}

		return fileId;
	}

	public async download(bucketName: string, fileId: string): Promise<FileLike> {
		const block = this.getBlock(bucketName, fileId);

		const blob = await block.download().catch((error) => {
			if (error instanceof Error) {
				throw new FileNotFoundError("Error downloading file", { cause: error });
			}

			throw error;
		});

		if (!blob.readableStreamBody) {
			throw new FileNotFoundError("File not found - empty stream body");
		}

		return file(blob.readableStreamBody, blob.metadata);
	}

	public async exists(bucketName: string, fileId: string): Promise<boolean> {
		return await this.getBlock(bucketName, fileId).exists();
	}

	public async delete(bucketName: string, fileId: string): Promise<void> {
		try {
			await this.getBlock(bucketName, fileId).delete();
		} catch (error) {
			if (error instanceof Error) {
				throw new FileNotFoundError("Error deleting file", { cause: error });
			}
			throw error;
		}
	}

	public getBlock(container: string, fileId: string): BlockBlobClient {
		if (!this.containers[container]) {
			throw new FileNotFoundError(
				`File '${fileId}' not found - container '${container}' does not exists`,
			);
		}

		return this.containers[container].getBlockBlobClient(fileId);
	}

	public readonly onStart = $hook({
		name: "start",
		handler: async () => {
			for (const bucket of this.bucketProvider.getBuckets()) {
				const containerName = bucket.name.replaceAll("/", "-").toLowerCase();
				this.log.debug(`Prepare container ${containerName}...`);

				if (!this.containers[containerName]) {
					this.containers[containerName] =
						await this.createContainerClient(containerName);
				}

				this.log.info(`Container ${bucket} OK`);
			}
		},
	});

	protected async createContainerClient(
		name: string,
	): Promise<ContainerClient> {
		const container = this.blobServiceClient.getContainerClient(name);

		await this.dateTimeProvider.deadline(
			(abortSignal) => container.createIfNotExists({ abortSignal }),
			[5, "seconds"],
		);

		return container;
	}

	protected createId(): string {
		return randomUUID();
	}
}
