import type { FileLike } from "alepha";

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

  /**
   * Delete multiple files in one round-trip where the provider supports
   * batch (R2/S3, up to 1000 per call). Memory/Local fall back to a loop.
   *
   * @param bucketName - Container name
   * @param fileIds - Identifiers of the files to delete
   */
  abstract deleteMany(bucketName: string, fileIds: string[]): Promise<void>;

  /**
   * Lists the file identifiers stored in a bucket, like `ls` on a directory.
   *
   * This is a flat, unpaginated listing intended for small buckets. Providers
   * cap the result at their natural page size (~1000 for S3/R2); anything beyond
   * that is silently dropped. It is NOT a search API — use `alepha/api/files`
   * when you need querying or pagination.
   *
   * @param bucketName - Container name
   * @return The identifiers of the files in the bucket (empty if none).
   */
  abstract list(bucketName: string): Promise<string[]>;
}
