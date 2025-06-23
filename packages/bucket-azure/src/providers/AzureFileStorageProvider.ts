import type { FileStorageProvider } from "@alepha/bucket";
import type { FileLike } from "@alepha/core";
import type { ContainerClient } from "@azure/storage-blob";

export class AzureFileStorageProvider implements FileStorageProvider {
	protected readonly containers: Record<string, ContainerClient> = {};

	upload(bucketName: string, file: FileLike, fileId?: string): Promise<string> {
		throw new Error("Method not implemented.");
	}

	download(bucketName: string, fileId: string): Promise<FileLike> {
		throw new Error("Method not implemented.");
	}

	exists(bucketName: string, fileId: string): Promise<boolean> {
		throw new Error("Method not implemented.");
	}

	delete(bucketName: string, fileId: string): Promise<void> {
		throw new Error("Method not implemented.");
	}
}
