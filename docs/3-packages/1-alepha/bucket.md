# Alepha - Bucket

## Installation

Part of the `alepha` package. Import from `alepha/bucket`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Unified file storage abstraction across multiple backends.

**Features:**
- File storage buckets with constraints
- Unified API across all storage backends
- MIME type validation
- File size limits
- Upload/download/delete operations
- TTL-based file expiration
- Providers: Memory (testing), Local filesystem, AWS S3 / Cloudflare R2 / MinIO, Azure Blob Storage, Vercel Blob

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $bucket()

Creates a bucket primitive for file storage and management with configurable validation.

Provides a comprehensive file storage system that handles uploads, downloads, validation,
and management across multiple storage backends with MIME type and size limit controls.

**Key Features**
- Multi-provider support (filesystem, cloud storage, in-memory)
- Automatic MIME type and file size validation
- Event integration for file operations monitoring
- Flexible per-bucket and per-operation configuration
- Smart file type and size detection

**Common Use Cases**
- User profile pictures and document uploads
- Product images and media management
- Document storage and retrieval systems

```ts
class MediaService {
  images = $bucket({
    name: "user-images",
    mimeTypes: ["image/jpeg", "image/png", "image/gif"],
    maxSize: 5 // 5MB limit
  });

  documents = $bucket({
    name: "documents",
    mimeTypes: ["application/pdf", "text/plain"],
    maxSize: 50 // 50MB limit
  });

  async uploadProfileImage(file: FileLike, userId: string): Promise<string> {
    const fileId = await this.images.upload(file);
    await this.userService.updateProfileImage(userId, fileId);
    return fileId;
  }

  async downloadDocument(documentId: string): Promise<FileLike> {
    return await this.documents.download(documentId);
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.documents.delete(documentId);
  }
}
```
