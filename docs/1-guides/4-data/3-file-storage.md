# File Storage

File uploads are one of those features that seem simple until you actually implement them. MIME type validation, size limits, cloud storage integration, signed URLs...

Alepha provides two layers for file storage, depending on your needs.

## Two Layers of File Storage

### Layer 1: `alepha/bucket` - Raw Blob Storage

The `$bucket` primitive provides raw blob storage. It handles:
- Uploading and downloading binary data
- MIME type and size validation
- Multiple storage backends (memory, filesystem, cloud)

This is the **low-level layer**. Files are stored as blobs with no metadata persistence.

```typescript
import { $bucket } from "alepha/bucket";

class MediaService {
  avatars = $bucket({
    name: "avatars",
    mimeTypes: ["image/jpeg", "image/png"],
    maxSize: 5, // MB
  });

  async upload(file: FileLike): Promise<string> {
    // Returns a blob ID - you manage metadata yourself
    return await this.avatars.upload(file);
  }
}
```

### Layer 2: `alepha/api-files` - Managed File Storage

The `AlephaApiFiles` module is a **superset** of `alepha/bucket`. It adds:
- Database persistence for file metadata
- Time-to-live (TTL) with automatic cleanup
- Tags for organization
- Creator tracking (audit trail)
- Checksum calculation (SHA-256)
- Storage statistics
- REST API endpoints

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api-files";

const alepha = Alepha.create().with(AlephaApiFiles);

run(alepha);
```

With `AlephaApiFiles`, every upload automatically:
1. Stores the blob in the bucket
2. Creates a database record with metadata
3. Schedules automatic deletion if TTL is set

## Using the Raw Bucket Layer

### Defining Buckets

```typescript
import { $bucket } from "alepha/bucket";

class MediaService {
  // Profile pictures: images only, 5MB max
  avatars = $bucket({
    name: "avatars",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 5,
  });

  // Documents: PDFs and office files, 50MB max
  documents = $bucket({
    name: "documents",
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxSize: 50,
  });
}
```

### Upload, Download, Delete

```typescript
class AvatarApi {
  media = $inject(MediaService);

  upload = $action({
    method: "POST",
    path: "/avatar",
    schema: {
      body: t.object({ file: t.file() }),
      response: t.object({ fileId: t.text() }),
    },
    handler: async ({ body }) => {
      const fileId = await this.media.avatars.upload(body.file);
      return { fileId };
    },
  });

  download = $action({
    path: "/avatar/:id",
    handler: async ({ params }) => {
      return await this.media.avatars.download(params.id);
    },
  });

  delete = $action({
    method: "DELETE",
    path: "/avatar/:id",
    handler: async ({ params }) => {
      await this.media.avatars.delete(params.id);
      return { ok: true };
    },
  });
}
```

## Using the Managed File Layer

### Enable the Module

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiFiles, FileService } from "alepha/api-files";

const alepha = Alepha.create().with(AlephaApiFiles);

run(alepha);
```

### Upload with Metadata

```typescript
class DocumentService {
  fileService = $inject(FileService);

  async uploadContract(file: FileLike, user: UserAccountToken) {
    // File is stored + metadata persisted in database
    const entity = await this.fileService.uploadFile(file, {
      bucket: "documents",
      user, // Creator tracking
      tags: ["contract", "legal"],
      expirationDate: "2025-12-31", // Auto-deleted after this date
    });

    return entity; // Includes id, name, size, mimeType, checksum, etc.
  }
}
```

### TTL with Automatic Cleanup

Set TTL at the bucket level or per-upload:

```typescript
class TempService {
  // All files in this bucket expire after 24 hours
  tempFiles = $bucket({
    name: "temp",
    ttl: [24, "hours"],
  });

  async uploadTemp(file: FileLike) {
    // Automatically deleted after 24 hours
    return await this.tempFiles.upload(file);
  }

  async uploadWithCustomTTL(file: FileLike) {
    // Override: expire in 1 hour
    return await this.tempFiles.upload(file, {
      ttl: [1, "hour"],
    });
  }
}
```

The `FileJobs` scheduler runs every 15 minutes to purge expired files.

### Query Files

```typescript
class AdminService {
  fileService = $inject(FileService);

  async listUserFiles(userId: string) {
    return await this.fileService.findFiles({
      creator: userId,
      sort: "-createdAt",
      page: 0,
      size: 20,
    });
  }

  async getStorageStats() {
    // Total size, file count, breakdown by bucket and MIME type
    return await this.fileService.getStorageStats();
  }
}
```

## Storage Backends

### Default Behavior

By default, `AlephaBucket` automatically selects:
- **Test/Serverless**: `MemoryFileStorageProvider` (in-memory, no persistence)
- **Other environments**: `LocalFileStorageProvider` (filesystem)

### Cloud Storage Providers

Cloud providers are **not bundled** with the main `alepha` package. Install them separately:

#### Azure Blob Storage

```bash
npm install @alepha/bucket-azure
```

```typescript
import { Alepha, run } from "alepha";
import { AlephaBucketAzure } from "@alepha/bucket-azure";

const alepha = Alepha.create().with(AlephaBucketAzure);

run(alepha);
```

Set `AZURE_STORAGE_CONNECTION_STRING` in your environment.

#### Vercel Blob

```bash
npm install @alepha/bucket-vercel
```

```typescript
import { Alepha, run } from "alepha";
import { AlephaBucketVercel } from "@alepha/bucket-vercel";

const alepha = Alepha.create().with(AlephaBucketVercel);

run(alepha);
```

Set `BLOB_READ_WRITE_TOKEN` in your environment.

### Using Multiple Providers

You can use different storage backends for different buckets in the same app via the `provider` option:

```typescript
import { $bucket, MemoryFileStorageProvider } from "alepha/bucket";
import { AzureFileStorageProvider } from "@alepha/bucket-azure";
import { VercelFileStorageProvider } from "@alepha/bucket-vercel";

class StorageService {
  // Temporary files: in-memory (fast, no persistence)
  temp = $bucket({
    name: "temp",
    provider: "memory", // Shorthand for MemoryFileStorageProvider
    maxSize: 10,
  });

  // User avatars: Azure Blob Storage
  avatars = $bucket({
    name: "avatars",
    provider: AzureFileStorageProvider,
    mimeTypes: ["image/jpeg", "image/png"],
    maxSize: 5,
  });

  // Public assets: Vercel Blob (CDN-backed)
  assets = $bucket({
    name: "assets",
    provider: VercelFileStorageProvider,
    maxSize: 50,
  });

  // Documents: Use default provider (from DI container)
  documents = $bucket({
    name: "documents",
    // No provider specified - uses FileStorageProvider from DI
    mimeTypes: ["application/pdf"],
    maxSize: 100,
  });
}
```

Provider options:
- `"memory"` - In-memory storage (shorthand)
- `MemoryFileStorageProvider` - In-memory storage (explicit)
- `LocalFileStorageProvider` - Local filesystem
- `AzureFileStorageProvider` - Azure Blob Storage
- `VercelFileStorageProvider` - Vercel Blob
- `undefined` - Use the default from dependency injection

## Complete Example: Profile Picture Upload

```typescript
import { $bucket } from "alepha/bucket";
import { AzureFileStorageProvider } from "@alepha/bucket-azure";

class ProfileService {
  repo = $repository(userEntity);

  avatars = $bucket({
    name: "avatars",
    provider: AzureFileStorageProvider,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 5,
  });

  uploadAvatar = $action({
    method: "POST",
    path: "/profile/avatar",
    secure: true,
    schema: {
      body: t.object({ file: t.file() }),
      response: t.object({ avatarUrl: t.text() }),
    },
    handler: async ({ body, user }) => {
      // Delete old avatar if exists
      const profile = await this.repo.findById(user.id);
      if (profile.avatarId) {
        await this.avatars.delete(profile.avatarId);
      }

      // Upload new one
      const fileId = await this.avatars.upload(body.file);

      // Update user record
      await this.repo.updateById(user.id, { avatarId: fileId });

      return { avatarUrl: `/api/avatar/${fileId}` };
    },
  });

  getAvatar = $action({
    path: "/avatar/:id",
    handler: async ({ params }) => {
      return await this.avatars.download(params.id);
    },
  });
}
```

## Bucket Events

The bucket layer emits events you can hook into:

```typescript
class FileAuditService {
  onUpload = $hook({
    on: "bucket:file:uploaded",
    handler: async ({ id, file, bucket, options }) => {
      console.log(`File ${file.name} uploaded to ${bucket.name}`);
    },
  });

  onDelete = $hook({
    on: "bucket:file:deleted",
    handler: async ({ id, bucket }) => {
      console.log(`File ${id} deleted from ${bucket.name}`);
    },
  });
}
```

The `AlephaApiFiles` module uses these hooks internally to persist metadata to the database.

## Comparison: Raw vs Managed

| Feature | `alepha/bucket` | `alepha/api-files` |
|---------|-----------------|-------------------|
| Blob storage | Yes | Yes |
| MIME/size validation | Yes | Yes |
| Multiple backends | Yes | Yes |
| Database metadata | No | Yes |
| TTL/auto-delete | No | Yes |
| Tags | No | Yes |
| Creator tracking | No | Yes |
| Checksum | No | Yes |
| REST API | No | Yes |
| Storage stats | No | Yes |

**Use `alepha/bucket` when:**
- You manage metadata yourself
- You don't need TTL or tags
- You want minimal dependencies

**Use `alepha/api-files` when:**
- You need file metadata in the database
- You want automatic TTL cleanup
- You need audit trails (who uploaded what)
- You want built-in REST endpoints

## Tips

1. **Use specific MIME types** - `image/jpeg` is safer than `image/*`
2. **Set reasonable size limits** - Don't trust the client
3. **Store file IDs, not URLs** - URLs change, IDs don't
4. **Delete orphaned files** - Clean up when records are deleted
5. **Use TTL for temp files** - Automatic cleanup prevents storage bloat
6. **Use multiple providers** - Temp files in memory, permanent files in cloud

## Summary

| Need | Solution |
|------|----------|
| Raw blob storage | `$bucket({ name, mimeTypes, maxSize })` |
| Managed files with metadata | `AlephaApiFiles` module |
| Accept file in action | `t.file()` in schema |
| Upload file | `bucket.upload(file)` |
| Download file | `bucket.download(fileId)` |
| Delete file | `bucket.delete(fileId)` |
| Use Azure storage | Install `@alepha/bucket-azure`, use `AlephaBucketAzure` |
| Use Vercel storage | Install `@alepha/bucket-vercel`, use `AlephaBucketVercel` |
| Multiple providers | Set `provider` option per bucket |
| Auto-delete expired files | Set `ttl` option with `AlephaApiFiles` |
