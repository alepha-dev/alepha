import { createHash } from "node:crypto";
import {
  $bucket,
  type BucketDescriptor,
  FileNotFoundError,
} from "@alepha/bucket";
import { $hook, $inject, Alepha, type FileLike } from "@alepha/core";
import {
  type DateTime,
  DateTimeProvider,
  type DurationLike,
} from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { $repository, type Page } from "@alepha/postgres";
import type { UserAccountToken } from "@alepha/security";
import type { Ok } from "@alepha/server";
import { NotFoundError } from "@alepha/server";
import { type FileEntity, files } from "../entities/files.ts";
import type { FileQuery } from "../schemas/fileQuerySchema.ts";
import type { FileResource } from "../schemas/fileResourceSchema.ts";
import type { StorageStats } from "../schemas/storageStatsSchema.ts";

export class FileService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fileRepository = $repository(files);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly defaultBucket = $bucket({ name: "default" });

  protected onUploadFile = $hook({
    on: "bucket:file:uploaded",
    handler: async ({ file, bucket, options, id }) => {
      if (options.persist === false) {
        return;
      }

      const checksum = await this.calculateChecksum(file);

      await this.fileRepository.create({
        blobId: id,
        mimeType: file.type,
        name: file.name,
        size: file.size,
        creator: options.user?.id,
        creatorRealm: options.user?.realm,
        expirationDate: this.getExpirationDate(options.ttl),
        bucket: bucket.name,
        checksum,
      });
    },
  });

  protected onDeleteBucketFile = $hook({
    on: "bucket:file:deleted",
    handler: async ({ bucket, id }) => {
      await this.fileRepository.deleteMany({
        blobId: { eq: id },
        bucket: { eq: bucket.name },
      });
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Calculates SHA-256 checksum of a file.
   *
   * @param file - The file to calculate checksum for
   * @returns Hexadecimal string representation of the SHA-256 hash
   * @protected
   */
  protected async calculateChecksum(file: FileLike): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hash = createHash("sha256");
    hash.update(Buffer.from(buffer));
    return hash.digest("hex");
  }

  /**
   * Gets a bucket descriptor by name.
   *
   * @param bucketName - The name of the bucket to retrieve (defaults to "default")
   * @returns The bucket descriptor
   * @throws {NotFoundError} If the bucket is not found
   */
  public bucket(
    bucketName: string = this.defaultBucket.name,
  ): BucketDescriptor {
    const bucket = this.alepha
      .descriptors($bucket)
      .find((it) => it.name === bucketName);

    if (!bucket) {
      throw new NotFoundError(`Bucket '${bucketName}' not found.`);
    }

    return bucket;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Finds files matching the given query criteria with pagination support.
   * Supports filtering by bucket, tags, name, mimeType, creator, and date range.
   *
   * @param q - Query parameters including bucket, tags, name, mimeType, creator, date range, pagination, and sorting
   * @returns Paginated list of file entities
   */
  public async findFiles(q: FileQuery = {}): Promise<Page<FileEntity>> {
    q.sort ??= "-createdAt";

    const where = this.fileRepository.createQueryWhere();

    if (q.bucket) {
      where.bucket = { eq: q.bucket };
    }

    if (q.tags) {
      where.tags = { arrayContains: q.tags };
    }

    if (q.name) {
      where.name = { ilike: `%${q.name}%` };
    }

    if (q.mimeType) {
      where.mimeType = { eq: q.mimeType };
    }

    if (q.creator) {
      where.creator = { eq: q.creator };
    }

    if (q.createdAfter && q.createdBefore) {
      where.createdAt = {
        gte: q.createdAfter,
        lte: q.createdBefore,
      };
    } else if (q.createdAfter) {
      where.createdAt = { gte: q.createdAfter };
    } else if (q.createdBefore) {
      where.createdAt = { lte: q.createdBefore };
    }

    return await this.fileRepository
      .paginate(q, { where }, { count: true })
      .then((page) => {
        return {
          ...page,
          content: page.content.map((it) => this.entityToResource(it)),
        };
      });
  }

  /**
   * Finds files that have expired based on their expiration date.
   * Limited to 1000 files per call to prevent memory issues.
   *
   * @returns Array of expired file entities
   */
  public async findExpiredFiles(): Promise<FileEntity[]> {
    return await this.fileRepository.find({
      limit: 1000,
      where: {
        expirationDate: { lte: this.dateTimeProvider.now() },
      },
    });
  }

  /**
   * Calculates an expiration date based on a TTL (time to live) duration.
   *
   * @param ttl - Duration like "1 day", "2 hours", etc.
   * @returns DateTime representation of the expiration date, or undefined if no TTL provided
   * @protected
   */
  protected getExpirationDate(ttl?: DurationLike): DateTime | undefined {
    return ttl
      ? this.dateTimeProvider.now().add(this.dateTimeProvider.duration(ttl))
      : undefined;
  }

  /**
   * Uploads a file to a bucket and creates a database record with metadata.
   * Automatically calculates and stores the file checksum (SHA-256).
   *
   * @param file - The file to upload
   * @param options - Upload options including bucket, expiration, user, and tags
   * @param options.bucket - Target bucket name (defaults to "default")
   * @param options.expirationDate - When the file should expire
   * @param options.user - User performing the upload (for audit trail)
   * @param options.tags - Tags to associate with the file
   * @returns The created file entity with all metadata
   * @throws {NotFoundError} If the specified bucket doesn't exist
   */
  public async uploadFile(
    file: FileLike,
    options: {
      expirationDate?: string | DateTime;
      bucket?: string;
      user?: UserAccountToken;
      tags?: string[];
    } = {},
  ): Promise<FileEntity> {
    const bucket = this.bucket(options.bucket);

    const checksum = await this.calculateChecksum(file);
    const blobId = await bucket.upload(file, { persist: false });

    let expirationDate: DateTime | undefined;
    if (options.expirationDate) {
      expirationDate = this.dateTimeProvider.of(options.expirationDate);
    } else if (bucket.options.ttl) {
      expirationDate = this.getExpirationDate(bucket.options.ttl);
    }

    return await this.fileRepository.create({
      blobId: blobId,
      mimeType: file.type,
      name: file.name,
      size: file.size,
      creator: options.user?.id,
      creatorRealm: options.user?.realm,
      creatorName: options.user?.name,
      expirationDate,
      bucket: bucket.name,
      tags: options.tags,
      checksum,
    });
  }

  /**
   * Streams a file from storage by its database ID.
   *
   * @param id - The database ID (UUID) of the file to stream
   * @returns The file object ready for streaming/downloading
   * @throws {NotFoundError} If the file doesn't exist in the database
   * @throws {FileNotFoundError} If the file exists in database but not in storage
   */
  public async streamFile(id: string): Promise<FileLike> {
    const entity = await this.getFileById(id);
    const bucket = this.bucket(entity.bucket);

    return await bucket.download(entity.blobId);
  }

  /**
   * Updates file metadata (name, tags, expiration date).
   * Does not modify the actual file content in storage.
   *
   * @param id - The database ID (UUID) of the file to update
   * @param data - Partial file data to update
   * @param data.name - New file name
   * @param data.tags - New tags array
   * @param data.expirationDate - New expiration date
   * @returns The updated file entity
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async updateFile(
    id: string,
    data: {
      name?: string;
      tags?: string[];
      expirationDate?: DateTime;
    },
  ): Promise<FileEntity> {
    const file = await this.getFileById(id);

    const updateData: Partial<FileEntity> = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.tags !== undefined) {
      updateData.tags = data.tags;
    }

    if (data.expirationDate !== undefined) {
      updateData.expirationDate = data.expirationDate;
    }

    return await this.fileRepository.updateById(file.id, updateData);
  }

  /**
   * Deletes a file from both storage and database.
   * Handles cases where file is already deleted from storage gracefully.
   * Always ensures database record is removed even if storage deletion fails.
   *
   * @param id - The database ID (UUID) of the file to delete
   * @returns Success response with the deleted file ID
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async deleteFile(id: string): Promise<Ok> {
    const file = await this.getFileById(id);
    const bucket = this.bucket(file.bucket);

    try {
      await bucket.delete(file.blobId);
    } catch (e) {
      if (e instanceof FileNotFoundError) {
        // File is already deleted in the bucket, this is okay
        this.log.debug(
          `File ${file.blobId} not found in bucket ${bucket.name}, cleaning up database record`,
        );
      } else {
        // Other errors (permission, network, etc.) - log but continue to clean up database
        this.log.warn(
          `Failed to delete file ${file.blobId} from bucket ${bucket.name}`,
          e,
        );
      }
    }

    // Always delete the database record
    await this.fileRepository.deleteById(file.id);

    return { ok: true, id: String(file.id) };
  }

  /**
   * Retrieves a file entity by its ID.
   * If already an entity object, returns it as-is (convenience method).
   *
   * @param id - Either a UUID string or an existing FileEntity object
   * @returns The file entity
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async getFileById(id: string | FileEntity): Promise<FileEntity> {
    if (typeof id === "object") {
      return id;
    }

    return await this.fileRepository.findById(id);
  }

  /**
   * Gets storage statistics including total size, file count, and breakdowns by bucket and MIME type.
   *
   * @returns Storage statistics with aggregated data
   */
  public async getStorageStats(): Promise<StorageStats> {
    const allFiles = await this.fileRepository.find({});

    const totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);
    const totalFiles = allFiles.length;

    // Group by bucket
    const bucketMap = new Map<
      string,
      { totalSize: number; fileCount: number }
    >();
    for (const file of allFiles) {
      const existing = bucketMap.get(file.bucket) || {
        totalSize: 0,
        fileCount: 0,
      };
      existing.totalSize += file.size;
      existing.fileCount += 1;
      bucketMap.set(file.bucket, existing);
    }

    // Group by MIME type
    const mimeTypeMap = new Map<string, number>();
    for (const file of allFiles) {
      const existing = mimeTypeMap.get(file.mimeType) || 0;
      mimeTypeMap.set(file.mimeType, existing + 1);
    }

    return {
      totalSize,
      totalFiles,
      byBucket: Array.from(bucketMap.entries()).map(([bucket, stats]) => ({
        bucket,
        totalSize: stats.totalSize,
        fileCount: stats.fileCount,
      })),
      byMimeType: Array.from(mimeTypeMap.entries()).map(
        ([mimeType, fileCount]) => ({
          mimeType,
          fileCount,
        }),
      ),
    };
  }

  /**
   * Converts a file entity to a file resource (API response format).
   * Currently a pass-through, but allows for future transformation logic.
   *
   * @param entity - The file entity to convert
   * @returns The file resource for API responses
   */
  public entityToResource(entity: FileEntity): FileResource {
    return entity;
  }
}
