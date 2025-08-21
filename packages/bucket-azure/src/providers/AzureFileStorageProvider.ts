import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
	$bucket,
	FileNotFoundError,
	type FileStorageProvider,
} from "@alepha/bucket";
import {
	$env,
	$hook,
	$inject,
	Alepha,
	type FileLike,
	type Static,
	t,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { createFile } from "@alepha/file";
import { $logger } from "@alepha/logger";
import {
	BlobServiceClient,
	type BlockBlobClient,
	type ContainerClient,
	type StoragePipelineOptions,
} from "@azure/storage-blob";

const envSchema = t.object({
	AZ_STORAGE_CONNECTION_STRING: t.string({
		size: "long",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Azure Blog Storage implementation of File Storage Provider.
 */
export class AzureFileStorageProvider implements FileStorageProvider {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly time = $inject(DateTimeProvider);
	protected readonly containers: Record<string, ContainerClient> = {};
	protected readonly blobServiceClient: BlobServiceClient;

	public readonly options: StoragePipelineOptions = {};

	constructor() {
		this.blobServiceClient = BlobServiceClient.fromConnectionString(
			this.env.AZ_STORAGE_CONNECTION_STRING,
			this.options,
		);
	}

	protected readonly onStart = $hook({
		on: "start",
		handler: async () => {
			for (const bucket of this.alepha.descriptors($bucket)) {
				if (bucket.provider !== this) {
					continue;
				}

				const containerName = this.convertName(bucket.name);
				this.log.debug(`Prepare container '${containerName}' ...`);

				if (!this.containers[containerName]) {
					this.containers[containerName] =
						await this.createContainerClient(containerName);
				}

				this.log.info(`Container '${bucket.name}' OK`);
			}
		},
	});

	public convertName(name: string): string {
		// Azure Blob Storage does not allow uppercase letters in container names
		return name.replaceAll("/", "-").toLowerCase();
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
			await block.uploadStream(
				Readable.from(file.stream()),
				file.size || undefined,
				5,
				{
					metadata,
					blobHTTPHeaders: {
						blobContentType: file.type,
					},
				},
			);
		}

		return fileId;
	}

	public async download(bucketName: string, fileId: string): Promise<FileLike> {
		this.log.trace(
			`Downloading file '${fileId}' from bucket '${bucketName}'...`,
		);
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

		return createFile(blob.readableStreamBody, {
			...blob.metadata,
			size: blob.contentLength,
		});
	}

	public async exists(bucketName: string, fileId: string): Promise<boolean> {
		this.log.trace(
			`Checking existence of file '${fileId}' in bucket '${bucketName}'...`,
		);
		return await this.getBlock(bucketName, fileId).exists();
	}

	public async delete(bucketName: string, fileId: string): Promise<void> {
		this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);
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
		const containerName = this.convertName(container);

		if (!this.containers[containerName]) {
			throw new FileNotFoundError(
				`File '${fileId}' not found - container '${container}' does not exists`,
			);
		}

		return this.containers[containerName].getBlockBlobClient(fileId);
	}

	protected async createContainerClient(
		name: string,
	): Promise<ContainerClient> {
		const container = this.blobServiceClient.getContainerClient(name);

		await this.time.deadline(
			(abortSignal) => container.createIfNotExists({ abortSignal }),
			[5, "seconds"],
		);

		return container;
	}

	protected createId(): string {
		return randomUUID();
	}
}
