import {
  $inject,
  createPrimitive,
  type FileLike,
  KIND,
  Primitive,
  type Service,
} from "alepha";
import { FileSystemProvider } from "alepha/system";
import { InvalidFileError } from "../errors/InvalidFileError.ts";
import { FileStorageProvider } from "../providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";

/**
 * Creates a bucket primitive for file storage and management with configurable validation.
 *
 * Provides a comprehensive file storage system that handles uploads, downloads, validation,
 * and management across multiple storage backends with MIME type and size limit controls.
 *
 * **Key Features**
 * - Multi-provider support (filesystem, cloud storage, in-memory)
 * - Automatic MIME type and file size validation
 * - Event integration for file operations monitoring
 * - Flexible per-bucket and per-operation configuration
 * - Smart file type and size detection
 *
 * **Common Use Cases**
 * - User profile pictures and document uploads
 * - Product images and media management
 * - Document storage and retrieval systems
 *
 * @example
 * ```ts
 * class MediaService {
 *   images = $bucket({
 *     name: "user-images",
 *     mimeTypes: ["image/jpeg", "image/png", "image/gif"],
 *     maxSize: 5 // 5MB limit
 *   });
 *
 *   documents = $bucket({
 *     name: "documents",
 *     mimeTypes: ["application/pdf", "text/plain"],
 *     maxSize: 50 // 50MB limit
 *   });
 *
 *   async uploadProfileImage(file: FileLike, userId: string): Promise<string> {
 *     const fileId = await this.images.upload(file);
 *     await this.userService.updateProfileImage(userId, fileId);
 *     return fileId;
 *   }
 *
 *   async downloadDocument(documentId: string): Promise<FileLike> {
 *     return await this.documents.download(documentId);
 *   }
 *
 *   async deleteDocument(documentId: string): Promise<void> {
 *     await this.documents.delete(documentId);
 *   }
 * }
 * ```
 */
export const $bucket = (options: BucketPrimitiveOptions) =>
  createPrimitive(BucketPrimitive, options);

export interface BucketPrimitiveOptions extends BucketFileOptions {
  /**
   * File storage provider configuration for the bucket.
   *
   * Options:
   * - **"memory"**: In-memory storage (default for development, lost on restart)
   * - **Service<FileStorageProvider>**: Custom provider class (e.g., S3FileStorageProvider, AzureBlobProvider)
   * - **undefined**: Uses the default file storage provider from dependency injection
   *
   * **Provider Selection Guidelines**:
   * - **Development**: Use "memory" for fast, simple testing without external dependencies
   * - **Production**: Use cloud providers (S3, Azure Blob, Google Cloud Storage) for scalability
   * - **Local deployment**: Use filesystem providers for on-premise installations
   * - **Hybrid**: Use different providers for different bucket types (temp files vs permanent storage)
   *
   * **Provider Capabilities**:
   * - File persistence and durability guarantees
   * - Scalability and performance characteristics
   * - Geographic distribution and CDN integration
   * - Cost implications for storage and bandwidth
   * - Backup and disaster recovery features
   *
   * @default Uses injected FileStorageProvider
   * @example "memory"
   * @example S3FileStorageProvider
   * @example AzureBlobStorageProvider
   */
  provider?: Service<FileStorageProvider> | "memory";

  /**
   * Unique name identifier for the bucket.
   *
   * This name is used for:
   * - Storage backend organization and partitioning
   * - File path generation and URL construction
   * - Logging, monitoring, and debugging
   * - Access control and permissions management
   * - Backup and replication configuration
   *
   * **Naming Conventions**:
   * - Use lowercase with hyphens for consistency
   * - Include purpose or content type in the name
   * - Avoid spaces and special characters
   * - Consider environment prefixes for deployment isolation
   *
   * If not provided, defaults to the property key where the bucket is declared.
   *
   * @example "user-avatars"
   * @example "product-images"
   * @example "legal-documents"
   * @example "temp-processing-files"
   */
  name?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface BucketFileOptions {
  /**
   * Human-readable description of the bucket's purpose and contents.
   *
   * Used for:
   * - Documentation generation and API references
   * - Developer onboarding and system understanding
   * - Monitoring dashboards and admin interfaces
   * - Compliance and audit documentation
   *
   * **Description Best Practices**:
   * - Explain what types of files this bucket stores
   * - Mention any special handling or processing requirements
   * - Include information about retention policies if applicable
   * - Note any compliance or security considerations
   *
   * @example "User profile pictures and avatar images"
   * @example "Product catalog images with automated thumbnail generation"
   * @example "Legal documents requiring long-term retention"
   * @example "Temporary files for data processing workflows"
   */
  description?: string;

  /**
   * Array of allowed MIME types for files uploaded to this bucket.
   *
   * When specified, only files with these exact MIME types will be accepted.
   * Files with disallowed MIME types will be rejected with an InvalidFileError.
   *
   * **MIME Type Categories**:
   * - Images: "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"
   * - Documents: "application/pdf", "text/plain", "text/csv"
   * - Office: "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
   * - Archives: "application/zip", "application/x-tar", "application/gzip"
   * - Media: "video/mp4", "audio/mpeg", "audio/wav"
   *
   * **Security Considerations**:
   * - Always validate MIME types for user uploads
   * - Be cautious with executable file types
   * - Consider using allow-lists rather than deny-lists
   * - Remember that MIME types can be spoofed by malicious users
   *
   * If not specified, all MIME types are allowed (not recommended for user uploads).
   *
   * @example ["image/jpeg", "image/png"] // Only JPEG and PNG images
   * @example ["application/pdf", "text/plain"] // Documents only
   * @example ["video/mp4", "video/webm"] // Video files
   */
  mimeTypes?: string[];

  /**
   * Maximum file size allowed in megabytes (MB).
   *
   * Files larger than this limit will be rejected with an InvalidFileError.
   * This helps prevent:
   * - Storage quota exhaustion
   * - Memory issues during file processing
   * - Long upload times and timeouts
   * - Abuse of storage resources
   *
   * **Size Guidelines by File Type**:
   * - Profile images: 1-5 MB
   * - Product photos: 5-10 MB
   * - Documents: 10-50 MB
   * - Video files: 50-500 MB
   * - Data files: 100-1000 MB
   *
   * **Considerations**:
   * - Consider your storage costs and limits
   * - Factor in network upload speeds for users
   * - Account for processing requirements (thumbnails, compression)
   * - Set reasonable limits based on actual use cases
   *
   * @default 10 MB
   *
   * @example 1    // 1MB for small images
   * @example 25   // 25MB for documents
   * @example 100  // 100MB for media files
   */
  maxSize?: number;
}

// ---------------------------------------------------------------------------------------------------------------------

export class BucketPrimitive extends Primitive<BucketPrimitiveOptions> {
  public readonly provider = this.$provider();
  protected readonly fileSystem = $inject(FileSystemProvider);

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Uploads a file to the bucket.
   */
  public async upload(
    file: FileLike,
    options?: BucketFileOptions,
  ): Promise<string> {
    if (file instanceof File) {
      // our createFile is smarter than the browser's File constructor
      // by doing this, we can guess the MIME type and size!
      file = this.fileSystem.createFile({ file });
    }

    options = {
      ...this.options,
      ...options,
    };

    const mimeTypes = options.mimeTypes ?? undefined;
    const maxSize = options.maxSize ?? 10; // Default to 10 MB if not specified

    if (mimeTypes) {
      const mimeType = file.type || "application/octet-stream";
      if (!mimeTypes.includes(mimeType)) {
        throw new InvalidFileError(
          `MIME type ${mimeType} is not allowed in bucket ${this.name}`,
        );
      }
    }

    // A reported size of 0 means the body is a one-shot stream — real streams
    // report 0 until fully read (see FileLike.size). Materialize it once so
    // that (a) the maxSize check below is accurate instead of being silently
    // bypassed, and (b) the provider AND any `bucket:file:uploaded` hook can
    // read the same bytes without draining the stream out from under each
    // other. Files with a known size are already random-access (Blob/Buffer
    // backed) and need no copy. Uploads are size-capped, so this is bounded.
    if (file.size === 0) {
      file = this.fileSystem.createFile({
        arrayBuffer: await file.arrayBuffer(),
        name: file.name,
        type: file.type,
      });
    }

    // check size in bytes, convert MB to bytes
    if (file.size > maxSize * 1024 * 1024) {
      throw new InvalidFileError(
        `File size ${file.size} exceeds the maximum size of ${maxSize} MB in bucket ${this.name}`,
      );
    }

    const id = await this.provider.upload(this.name, file);

    await this.alepha.events.emit("bucket:file:uploaded", {
      id,
      bucket: this,
      file,
      options,
    });

    return id;
  }

  /**
   * Delete permanently a file from the bucket.
   */
  public async delete(fileId: string, skipHook = false): Promise<void> {
    await this.provider.delete(this.name, fileId);

    if (skipHook) {
      return;
    }

    await this.alepha.events.emit("bucket:file:deleted", {
      id: fileId,
      bucket: this,
    });
  }

  /**
   * Delete many files in one round-trip when the underlying provider supports
   * batch (R2/S3 up to 1000 keys per call). Emits one `bucket:file:deleted`
   * event per id unless `skipHook` is set.
   */
  public async deleteMany(fileIds: string[], skipHook = false): Promise<void> {
    if (fileIds.length === 0) return;
    await this.provider.deleteMany(this.name, fileIds);

    if (skipHook) {
      return;
    }

    for (const id of fileIds) {
      await this.alepha.events.emit("bucket:file:deleted", {
        id,
        bucket: this,
      });
    }
  }

  /**
   * Checks if a file exists in the bucket.
   */
  public async exists(fileId: string): Promise<boolean> {
    return this.provider.exists(this.name, fileId);
  }

  /**
   * Lists the file identifiers stored in the bucket, like `ls` on a directory.
   *
   * This is a flat, unpaginated listing meant for small buckets — the result is
   * capped at the provider's natural page size (~1000 for S3/R2) and anything
   * beyond that is silently dropped. It is NOT a search API; reach for
   * `alepha/api/files` when you need querying or pagination.
   */
  public async list(): Promise<string[]> {
    return this.provider.list(this.name);
  }

  /**
   * Downloads a file from the bucket.
   */
  public async download(fileId: string): Promise<FileLike> {
    const file = await this.provider.download(this.name, fileId);

    await this.alepha.events.emit("bucket:file:downloaded", {
      id: fileId,
      bucket: this,
      file,
    });

    return file;
  }

  protected $provider() {
    if (!this.options.provider) {
      return this.alepha.inject(FileStorageProvider);
    }
    if (this.options.provider === "memory") {
      return this.alepha.inject(MemoryFileStorageProvider);
    }
    return this.alepha.inject(this.options.provider);
  }
}

$bucket[KIND] = BucketPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface BucketFileOptions {
  /**
   * Optional description of the bucket.
   */
  description?: string;

  /**
   * Allowed MIME types.
   */
  mimeTypes?: string[];

  /**
   * Maximum size of the files in the bucket.
   *
   * @default 10
   */
  maxSize?: number;
}
