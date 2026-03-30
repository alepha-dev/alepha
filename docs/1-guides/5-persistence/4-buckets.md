# Buckets

`$bucket` provides a file storage abstraction that works across multiple backends: local filesystem, S3-compatible stores, Cloudflare R2, Vercel Blob, Azure Blob Storage, and in-memory (for testing).

```typescript
import { $bucket } from "alepha/bucket";
```

## Defining a Bucket

Declare a bucket as a class property with optional MIME type and size constraints:

```typescript
import { $bucket } from "alepha/bucket";

class MediaService {
  images = $bucket({
    name: "user-images",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 5, // MB
  });

  documents = $bucket({
    name: "documents",
    mimeTypes: ["application/pdf", "text/plain"],
    maxSize: 50, // MB
  });
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | Property key name | Unique bucket identifier used for storage partitioning |
| `mimeTypes` | `string[]` | All types allowed | Allowed MIME types. Rejects uploads with non-matching types |
| `maxSize` | `number` | `10` | Maximum file size in MB |
| `description` | `string` | - | Human-readable description of the bucket's purpose |
| `provider` | `Service` or `"memory"` | Injected `FileStorageProvider` | Override the storage backend for this bucket |

## Methods

### upload

Upload a file. Returns a string file ID.

```typescript
const fileId = await this.images.upload(file);
```

The `file` parameter accepts a `FileLike` object (compatible with the browser `File` API). Upload validates MIME type and file size against bucket constraints. Throws `InvalidFileError` if validation fails.

You can override bucket-level constraints per upload:

```typescript
const fileId = await this.images.upload(file, {
  mimeTypes: ["image/png"],
  maxSize: 2,
});
```

### download

Download a file by its ID. Returns a `FileLike` object.

```typescript
const file = await this.documents.download(fileId);
```

### exists

Check whether a file exists in the bucket.

```typescript
const found = await this.images.exists(fileId);
```

### delete

Permanently delete a file from the bucket.

```typescript
await this.images.delete(fileId);
```

## Storage Providers

The default provider depends on the environment:

- **Test / Serverless**: `MemoryFileStorageProvider` (in-memory, lost on restart)
- **Other environments**: `LocalFileStorageProvider` (writes to local filesystem)

### Available Providers

| Provider | Package | Description |
|----------|---------|-------------|
| `MemoryFileStorageProvider` | `alepha/bucket` | In-memory storage for testing |
| `LocalFileStorageProvider` | `alepha/bucket` | Local filesystem storage |
| `CloudflareR2Provider` | `alepha/bucket` | Cloudflare R2 (S3-compatible) |
| `S3FileStorageProvider` | `@alepha/bucket-s3` | AWS S3 / MinIO |

### Configuring a Provider

Override the default provider globally:

```typescript
import { AlephaBucket, FileStorageProvider } from "alepha/bucket";
import { S3FileStorageProvider } from "@alepha/bucket-s3";

const alepha = Alepha.create()
  .with(AlephaBucket)
  .with({ provide: FileStorageProvider, use: S3FileStorageProvider });
```

Or per bucket:

```typescript
import { S3FileStorageProvider } from "@alepha/bucket-s3";

class MediaService {
  images = $bucket({
    name: "user-images",
    provider: S3FileStorageProvider,
  });

  tempFiles = $bucket({
    name: "temp",
    provider: "memory",
  });
}
```

## Events

Bucket operations emit lifecycle events:

| Event | Payload |
|-------|---------|
| `bucket:file:uploaded` | `{ id, file, bucket, options }` |
| `bucket:file:deleted` | `{ id, bucket }` |

These events can be used to trigger side effects such as creating database records, generating thumbnails, or sending notifications.

## Testing

In tests, the `MemoryFileStorageProvider` is used by default. Use `MemoryFileStorageProvider` from `alepha/bucket` to inspect stored files in test assertions:

```typescript
const alepha = Alepha.create();

class TestApp {
  media = $bucket({ name: "test-media" });
}

const app = alepha.inject(TestApp);
await alepha.start();

const fileId = await app.media.upload(someFile);
const exists = await app.media.exists(fileId);
expect(exists).toBe(true);
```
