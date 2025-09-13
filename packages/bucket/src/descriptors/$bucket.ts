import {
	createDescriptor,
	Descriptor,
	type FileLike,
	KIND,
	type Service,
} from "@alepha/core";
import { createFile } from "@alepha/file";
import { InvalidFileError } from "../errors/InvalidFileError.ts";
import { FileStorageProvider } from "../providers/FileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";

/**
 * Creates a bucket descriptor for file storage and management with configurable validation.
 *
 * This descriptor provides a comprehensive file storage system that handles file uploads,
 * downloads, validation, and management across multiple storage backends. It supports
 * MIME type validation, size limits, and integrates seamlessly with various storage
 * providers for scalable file management in applications.
 *
 * **Key Features**
 *
 * - **Multi-Provider Support**: Works with filesystem, cloud storage (S3, Azure), and in-memory providers
 * - **File Validation**: Automatic MIME type checking and file size validation
 * - **Type Safety**: Full TypeScript support with FileLike interface compatibility
 * - **Event Integration**: Emits events for file operations (upload, delete) for monitoring
 * - **Flexible Configuration**: Per-bucket and per-operation configuration options
 * - **Automatic Detection**: Smart file type and size detection with fallback mechanisms
 * - **Error Handling**: Comprehensive error handling with descriptive error messages
 *
 * **Use Cases**
 *
 * Perfect for handling file storage requirements across applications:
 * - User profile picture and document uploads
 * - Product image and media management
 * - Document storage and retrieval systems
 * - Temporary file handling and processing
 * - Content delivery and asset management
 * - Backup and archival storage
 * - File-based data import/export workflows
 *
 * @example
 * **Basic file upload bucket:**
 * ```ts
 * import { $bucket } from "alepha/bucket";
 *
 * class MediaService {
 *   images = $bucket({
 *     name: "user-images",
 *     description: "User uploaded profile images and photos",
 *     mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
 *     maxSize: 5 // 5MB limit
 *   });
 *
 *   async uploadProfileImage(file: FileLike, userId: string): Promise<string> {
 *     // File is automatically validated against MIME types and size
 *     const fileId = await this.images.upload(file);
 *
 *     // Update user profile with new image
 *     await this.userService.updateProfileImage(userId, fileId);
 *
 *     return fileId;
 *   }
 *
 *   async getUserProfileImage(userId: string): Promise<FileLike> {
 *     const user = await this.userService.getUser(userId);
 *     if (!user.profileImageId) {
 *       throw new Error('User has no profile image');
 *     }
 *
 *     return await this.images.download(user.profileImageId);
 *   }
 * }
 * ```
 *
 * @example
 * **Document storage with multiple file types:**
 * ```ts
 * class DocumentManager {
 *   documents = $bucket({
 *     name: "company-documents",
 *     description: "Legal documents, contracts, and reports",
 *     mimeTypes: [
 *       "application/pdf",
 *       "application/msword",
 *       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 *       "text/plain",
 *       "text/csv"
 *     ],
 *     maxSize: 50 // 50MB for large documents
 *   });
 *
 *   async uploadDocument(file: FileLike, metadata: { title: string; category: string; userId: string }): Promise<string> {
 *     try {
 *       const fileId = await this.documents.upload(file);
 *
 *       // Store document metadata in database
 *       await this.database.documents.create({
 *         id: fileId,
 *         title: metadata.title,
 *         category: metadata.category,
 *         uploadedBy: metadata.userId,
 *         fileName: file.name,
 *         fileSize: file.size,
 *         mimeType: file.type,
 *         uploadedAt: new Date()
 *       });
 *
 *       console.log(`Document uploaded successfully: ${metadata.title} (${fileId})`);
 *       return fileId;
 *
 *     } catch (error) {
 *       console.error(`Failed to upload document: ${metadata.title}`, error);
 *       throw error;
 *     }
 *   }
 *
 *   async downloadDocument(documentId: string, userId: string): Promise<FileLike> {
 *     // Check permissions
 *     const document = await this.database.documents.findById(documentId);
 *     if (!document) {
 *       throw new Error('Document not found');
 *     }
 *
 *     const hasAccess = await this.permissionService.canAccessDocument(userId, documentId);
 *     if (!hasAccess) {
 *       throw new Error('Insufficient permissions to access document');
 *     }
 *
 *     // Download and return file
 *     return await this.documents.download(documentId);
 *   }
 *
 *   async deleteDocument(documentId: string, userId: string): Promise<void> {
 *     // Verify ownership or admin privileges
 *     const document = await this.database.documents.findById(documentId);
 *     if (document.uploadedBy !== userId && !await this.userService.isAdmin(userId)) {
 *       throw new Error('Cannot delete document: insufficient permissions');
 *     }
 *
 *     // Delete from storage and database
 *     await this.documents.delete(documentId);
 *     await this.database.documents.delete(documentId);
 *
 *     console.log(`Document deleted: ${document.title} (${documentId})`);
 *   }
 * }
 * ```
 *
 * @example
 * **Cloud storage integration with custom provider:**
 * ```ts
 * class ProductImageService {
 *   productImages = $bucket({
 *     name: "product-images",
 *     provider: S3FileStorageProvider, // Use AWS S3 for production storage
 *     description: "Product catalog images and thumbnails",
 *     mimeTypes: ["image/jpeg", "image/png", "image/webp"],
 *     maxSize: 10 // 10MB for high-quality product images
 *   });
 *
 *   thumbnails = $bucket({
 *     name: "product-thumbnails",
 *     provider: S3FileStorageProvider,
 *     description: "Generated product thumbnail images",
 *     mimeTypes: ["image/jpeg", "image/webp"],
 *     maxSize: 1 // 1MB for thumbnails
 *   });
 *
 *   async uploadProductImage(productId: string, file: FileLike): Promise<{ imageId: string; thumbnailId: string }> {
 *     try {
 *       // Upload original image
 *       const imageId = await this.productImages.upload(file);
 *
 *       // Generate and upload thumbnail
 *       const thumbnailFile = await this.imageProcessor.generateThumbnail(file, {
 *         width: 300,
 *         height: 300,
 *         format: 'webp',
 *         quality: 80
 *       });
 *
 *       const thumbnailId = await this.thumbnails.upload(thumbnailFile);
 *
 *       // Update product in database
 *       await this.database.products.update(productId, {
 *         imageId,
 *         thumbnailId,
 *         imageUpdatedAt: new Date()
 *       });
 *
 *       console.log(`Product images uploaded for ${productId}: image=${imageId}, thumbnail=${thumbnailId}`);
 *
 *       return { imageId, thumbnailId };
 *
 *     } catch (error) {
 *       console.error(`Failed to upload product image for ${productId}`, error);
 *       throw error;
 *     }
 *   }
 *
 *   async getProductImage(productId: string, thumbnail: boolean = false): Promise<FileLike> {
 *     const product = await this.database.products.findById(productId);
 *     if (!product) {
 *       throw new Error(`Product ${productId} not found`);
 *     }
 *
 *     const imageId = thumbnail ? product.thumbnailId : product.imageId;
 *     if (!imageId) {
 *       throw new Error(`Product ${productId} has no ${thumbnail ? 'thumbnail' : 'image'}`);
 *     }
 *
 *     const bucket = thumbnail ? this.thumbnails : this.productImages;
 *     return await bucket.download(imageId);
 *   }
 * }
 * ```
 *
 * @example
 * **Temporary file processing with memory storage:**
 * ```ts
 * class FileProcessingService {
 *   tempFiles = $bucket({
 *     name: "temp-processing",
 *     provider: "memory", // Use in-memory storage for temporary files
 *     description: "Temporary files during processing workflows",
 *     maxSize: 100 // Large limit for processing workflows
 *   });
 *
 *   async processDataFile(inputFile: FileLike, transformations: string[]): Promise<FileLike> {
 *     let currentFile = inputFile;
 *     const intermediateFiles: string[] = [];
 *
 *     try {
 *       // Upload initial file to temp storage
 *       let currentFileId = await this.tempFiles.upload(currentFile);
 *       intermediateFiles.push(currentFileId);
 *
 *       // Apply each transformation
 *       for (const transformation of transformations) {
 *         console.log(`Applying transformation: ${transformation}`);
 *
 *         // Download current file
 *         currentFile = await this.tempFiles.download(currentFileId);
 *
 *         // Apply transformation
 *         const transformedFile = await this.applyTransformation(currentFile, transformation);
 *
 *         // Upload transformed file
 *         currentFileId = await this.tempFiles.upload(transformedFile);
 *         intermediateFiles.push(currentFileId);
 *       }
 *
 *       // Download final result
 *       const finalFile = await this.tempFiles.download(currentFileId);
 *
 *       console.log(`File processing completed with ${transformations.length} transformations`);
 *       return finalFile;
 *
 *     } finally {
 *       // Clean up all intermediate files
 *       for (const fileId of intermediateFiles) {
 *         try {
 *           await this.tempFiles.delete(fileId);
 *         } catch (error) {
 *           console.warn(`Failed to clean up temp file ${fileId}:`, error.message);
 *         }
 *       }
 *       console.log(`Cleaned up ${intermediateFiles.length} temporary files`);
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * **File validation with dynamic configuration:**
 * ```ts
 * class UserContentService {
 *   userContent = $bucket({
 *     name: "user-content",
 *     description: "User-generated content with flexible validation"
 *     // Base configuration - can be overridden per operation
 *   });
 *
 *   async uploadUserFile(file: FileLike, userId: string, contentType: 'avatar' | 'document' | 'media'): Promise<string> {
 *     // Dynamic validation based on content type
 *     const validationConfig = this.getValidationConfig(contentType, userId);
 *
 *     try {
 *       // Upload with specific validation rules
 *       const fileId = await this.userContent.upload(file, validationConfig);
 *
 *       // Log upload for audit trail
 *       await this.auditLogger.log({
 *         action: 'file_upload',
 *         userId,
 *         fileId,
 *         contentType,
 *         fileName: file.name,
 *         fileSize: file.size,
 *         mimeType: file.type
 *       });
 *
 *       return fileId;
 *
 *     } catch (error) {
 *       console.error(`File upload failed for user ${userId}`, {
 *         contentType,
 *         fileName: file.name,
 *         error: error.message
 *       });
 *       throw error;
 *     }
 *   }
 *
 *   private getValidationConfig(contentType: string, userId: string) {
 *     const baseConfig = {
 *       avatar: {
 *         mimeTypes: ['image/jpeg', 'image/png'],
 *         maxSize: 2 // 2MB for avatars
 *       },
 *       document: {
 *         mimeTypes: ['application/pdf', 'text/plain'],
 *         maxSize: 10 // 10MB for documents
 *       },
 *       media: {
 *         mimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
 *         maxSize: 50 // 50MB for media files
 *       }
 *     };
 *
 *     const config = baseConfig[contentType];
 *
 *     // Premium users get higher limits
 *     if (this.userService.isPremium(userId)) {
 *       config.maxSize *= 2;
 *     }
 *
 *     return config;
 *   }
 * }
 * ```
 */
export const $bucket = (options: BucketDescriptorOptions) =>
	createDescriptor(BucketDescriptor, options);

export interface BucketDescriptorOptions extends BucketFileOptions {
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

export class BucketDescriptor extends Descriptor<BucketDescriptorOptions> {
	public readonly provider = this.$provider();

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
			file = createFile(file);
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

		// check size in bytes, convert MB to bytes
		if (file.size > maxSize * 1024 * 1024) {
			throw new InvalidFileError(
				`File size ${file.size} exceeds the maximum size of ${this.options.maxSize} MB in bucket ${this.name}`,
			);
		}

		const id = await this.provider.upload(this.name, file);

		await this.alepha.emit("bucket:file:uploaded", {
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
	public async delete(fileId: string): Promise<void> {
		await this.provider.delete(this.name, fileId);
		await this.alepha.emit("bucket:file:deleted", {
			id: fileId,
			bucket: this,
		});
	}

	/**
	 * Checks if a file exists in the bucket.
	 */
	public async exists(fileId: string): Promise<boolean> {
		return this.provider.exists(this.name, fileId);
	}

	/**
	 * Downloads a file from the bucket.
	 */
	public async download(fileId: string): Promise<FileLike> {
		return this.provider.download(this.name, fileId);
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

$bucket[KIND] = BucketDescriptor;

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
