import type { FileLike } from "@alepha/core";

export abstract class FileStorageProvider {
	/**
	 * Uploads a file to the storage.
	 *
	 * @param bucketName - Container name
	 * @param file - File to upload
	 * @param fileId - Optional file identifier. If not provided, a unique ID will be generated.
	 * @return The identifier of the uploaded file.
	 */
	abstract upload(
		bucketName: string,
		file: FileLike,
		fileId?: string,
	): Promise<string>;

	/**
	 * Downloads a file from the storage.
	 *
	 * @param bucketName - Container name
	 * @param fileId - Identifier of the file to download
	 * @return The downloaded file as a FileLike object.
	 */
	abstract download(bucketName: string, fileId: string): Promise<FileLike>;

	/**
	 * Check if fileId exists in the storage bucket.
	 *
	 * @param bucketName - Container name
	 * @param fileId - Identifier of the file to stream
	 * @return True is the file exists, false otherwise.
	 */
	abstract exists(bucketName: string, fileId: string): Promise<boolean>;

	/**
	 * Delete permanently a file from the storage.
	 *
	 * @param bucketName - Container name
	 * @param fileId - Identifier of the file to delete
	 */
	abstract delete(bucketName: string, fileId: string): Promise<void>;
}
