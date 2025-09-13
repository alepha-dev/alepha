# Alepha Bucket

A universal interface for object and file storage providers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides file storage capabilities through declarative bucket descriptors with support for multiple storage backends.

The bucket module enables unified file operations across different storage systems using the `$bucket` descriptor
on class properties. It abstracts storage provider differences, offering consistent APIs for local filesystem,
cloud storage, or in-memory storage for testing environments.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaBucket } from "alepha/bucket";

const alepha = Alepha.create()
	.with(AlephaBucket);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $bucket()

Creates a bucket descriptor for file storage and management with configurable validation.

This descriptor provides a comprehensive file storage system that handles file uploads,
downloads, validation, and management across multiple storage backends. It supports
MIME type validation, size limits, and integrates seamlessly with various storage
providers for scalable file management in applications.

**Key Features**

- **Multi-Provider Support**: Works with filesystem, cloud storage (S3, Azure), and in-memory providers
- **File Validation**: Automatic MIME type checking and file size validation
- **Type Safety**: Full TypeScript support with FileLike interface compatibility
- **Event Integration**: Emits events for file operations (upload, delete) for monitoring
- **Flexible Configuration**: Per-bucket and per-operation configuration options
- **Automatic Detection**: Smart file type and size detection with fallback mechanisms
- **Error Handling**: Comprehensive error handling with descriptive error messages

**Use Cases**

Perfect for handling file storage requirements across applications:
- User profile picture and document uploads
- Product image and media management
- Document storage and retrieval systems
- Temporary file handling and processing
- Content delivery and asset management
- Backup and archival storage
- File-based data import/export workflows

**Basic file upload bucket:**
```ts
import { $bucket } from "alepha/bucket";

class MediaService {
  images = $bucket({
    name: "user-images",
    description: "User uploaded profile images and photos",
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    maxSize: 5 // 5MB limit
  });

  async uploadProfileImage(file: FileLike, userId: string): Promise<string> {
    // File is automatically validated against MIME types and size
    const fileId = await this.images.upload(file);

    // Update user profile with new image
    await this.userService.updateProfileImage(userId, fileId);

    return fileId;
  }

  async getUserProfileImage(userId: string): Promise<FileLike> {
    const user = await this.userService.getUser(userId);
    if (!user.profileImageId) {
      throw new Error('User has no profile image');
    }

    return await this.images.download(user.profileImageId);
  }
}
```

**Document storage with multiple file types:**
```ts
class DocumentManager {
  documents = $bucket({
    name: "company-documents",
    description: "Legal documents, contracts, and reports",
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv"
    ],
    maxSize: 50 // 50MB for large documents
  });

  async uploadDocument(file: FileLike, metadata: { title: string; category: string; userId: string }): Promise<string> {
    try {
      const fileId = await this.documents.upload(file);

      // Store document metadata in database
      await this.database.documents.create({
        id: fileId,
        title: metadata.title,
        category: metadata.category,
        uploadedBy: metadata.userId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        uploadedAt: new Date()
      });

      console.log(`Document uploaded successfully: ${metadata.title} (${fileId})`);
      return fileId;

    } catch (error) {
      console.error(`Failed to upload document: ${metadata.title}`, error);
      throw error;
    }
  }

  async downloadDocument(documentId: string, userId: string): Promise<FileLike> {
    // Check permissions
    const document = await this.database.documents.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    const hasAccess = await this.permissionService.canAccessDocument(userId, documentId);
    if (!hasAccess) {
      throw new Error('Insufficient permissions to access document');
    }

    // Download and return file
    return await this.documents.download(documentId);
  }

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    // Verify ownership or admin privileges
    const document = await this.database.documents.findById(documentId);
    if (document.uploadedBy !== userId && !await this.userService.isAdmin(userId)) {
      throw new Error('Cannot delete document: insufficient permissions');
    }

    // Delete from storage and database
    await this.documents.delete(documentId);
    await this.database.documents.delete(documentId);

    console.log(`Document deleted: ${document.title} (${documentId})`);
  }
}
```

**Cloud storage integration with custom provider:**
```ts
class ProductImageService {
  productImages = $bucket({
    name: "product-images",
    provider: S3FileStorageProvider, // Use AWS S3 for production storage
    description: "Product catalog images and thumbnails",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 10 // 10MB for high-quality product images
  });

  thumbnails = $bucket({
    name: "product-thumbnails",
    provider: S3FileStorageProvider,
    description: "Generated product thumbnail images",
    mimeTypes: ["image/jpeg", "image/webp"],
    maxSize: 1 // 1MB for thumbnails
  });

  async uploadProductImage(productId: string, file: FileLike): Promise<{ imageId: string; thumbnailId: string }> {
    try {
      // Upload original image
      const imageId = await this.productImages.upload(file);

      // Generate and upload thumbnail
      const thumbnailFile = await this.imageProcessor.generateThumbnail(file, {
        width: 300,
        height: 300,
        format: 'webp',
        quality: 80
      });

      const thumbnailId = await this.thumbnails.upload(thumbnailFile);

      // Update product in database
      await this.database.products.update(productId, {
        imageId,
        thumbnailId,
        imageUpdatedAt: new Date()
      });

      console.log(`Product images uploaded for ${productId}: image=${imageId}, thumbnail=${thumbnailId}`);

      return { imageId, thumbnailId };

    } catch (error) {
      console.error(`Failed to upload product image for ${productId}`, error);
      throw error;
    }
  }

  async getProductImage(productId: string, thumbnail: boolean = false): Promise<FileLike> {
    const product = await this.database.products.findById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const imageId = thumbnail ? product.thumbnailId : product.imageId;
    if (!imageId) {
      throw new Error(`Product ${productId} has no ${thumbnail ? 'thumbnail' : 'image'}`);
    }

    const bucket = thumbnail ? this.thumbnails : this.productImages;
    return await bucket.download(imageId);
  }
}
```

**Temporary file processing with memory storage:**
```ts
class FileProcessingService {
  tempFiles = $bucket({
    name: "temp-processing",
    provider: "memory", // Use in-memory storage for temporary files
    description: "Temporary files during processing workflows",
    maxSize: 100 // Large limit for processing workflows
  });

  async processDataFile(inputFile: FileLike, transformations: string[]): Promise<FileLike> {
    let currentFile = inputFile;
    const intermediateFiles: string[] = [];

    try {
      // Upload initial file to temp storage
      let currentFileId = await this.tempFiles.upload(currentFile);
      intermediateFiles.push(currentFileId);

      // Apply each transformation
      for (const transformation of transformations) {
        console.log(`Applying transformation: ${transformation}`);

        // Download current file
        currentFile = await this.tempFiles.download(currentFileId);

        // Apply transformation
        const transformedFile = await this.applyTransformation(currentFile, transformation);

        // Upload transformed file
        currentFileId = await this.tempFiles.upload(transformedFile);
        intermediateFiles.push(currentFileId);
      }

      // Download final result
      const finalFile = await this.tempFiles.download(currentFileId);

      console.log(`File processing completed with ${transformations.length} transformations`);
      return finalFile;

    } finally {
      // Clean up all intermediate files
      for (const fileId of intermediateFiles) {
        try {
          await this.tempFiles.delete(fileId);
        } catch (error) {
          console.warn(`Failed to clean up temp file ${fileId}:`, error.message);
        }
      }
      console.log(`Cleaned up ${intermediateFiles.length} temporary files`);
    }
  }
}
```

**File validation with dynamic configuration:**
```ts
class UserContentService {
  userContent = $bucket({
    name: "user-content",
    description: "User-generated content with flexible validation"
    // Base configuration - can be overridden per operation
  });

  async uploadUserFile(file: FileLike, userId: string, contentType: 'avatar' | 'document' | 'media'): Promise<string> {
    // Dynamic validation based on content type
    const validationConfig = this.getValidationConfig(contentType, userId);

    try {
      // Upload with specific validation rules
      const fileId = await this.userContent.upload(file, validationConfig);

      // Log upload for audit trail
      await this.auditLogger.log({
        action: 'file_upload',
        userId,
        fileId,
        contentType,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type
      });

      return fileId;

    } catch (error) {
      console.error(`File upload failed for user ${userId}`, {
        contentType,
        fileName: file.name,
        error: error.message
      });
      throw error;
    }
  }

  private getValidationConfig(contentType: string, userId: string) {
    const baseConfig = {
      avatar: {
        mimeTypes: ['image/jpeg', 'image/png'],
        maxSize: 2 // 2MB for avatars
      },
      document: {
        mimeTypes: ['application/pdf', 'text/plain'],
        maxSize: 10 // 10MB for documents
      },
      media: {
        mimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
        maxSize: 50 // 50MB for media files
      }
    };

    const config = baseConfig[contentType];

    // Premium users get higher limits
    if (this.userService.isPremium(userId)) {
      config.maxSize *= 2;
    }

    return config;
  }
}
```
