import type { FileLike, StreamLike } from "@alepha/core";

export interface FileStorageProvider {
	/**
	 * Uploads a file to the storage.
	 */
	upload(container: string, file: FileLike, fileId?: string): Promise<string>;

	/**
	 * Checks if a file exists in the storage.
	 */
	exists(container: string, fileId: string): Promise<boolean>;

	/**
	 * Get file as a stream from the storage.
	 */
	stream(container: string, fileId: string): Promise<StreamLike>;

	/**
	 * Deletes a file from the storage.
	 */
	delete(container: string, fileId: string): Promise<void>;
}
