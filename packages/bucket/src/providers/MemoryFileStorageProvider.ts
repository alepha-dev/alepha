import type { FileLike } from "@alepha/core";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

export class MemoryFileStorageProvider implements FileStorageProvider {
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
