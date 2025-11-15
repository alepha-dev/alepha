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

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $bucket()

Creates a bucket descriptor for file storage and management with configurable validation.

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
