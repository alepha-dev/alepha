# File Storage

Alepha's `$bucket` primitive abstracts file storage. Switch providers without changing code.

## Storage Providers

### Local (Development)

```typescript
// Default in development - files stored on disk
const uploads = $bucket({ name: "uploads" });
```

Files are stored in `.alepha/buckets/` by default.

### S3-Compatible

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and any S3-compatible service.

```typescript
import { AlephaBucketS3 } from "@alepha/bucket-s3";

alepha.with(AlephaBucketS3);
```

#### AWS S3

```env
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_REGION=us-east-1
```

#### Cloudflare R2

```env
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
```

#### MinIO (Self-Hosted)

```env
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

#### DigitalOcean Spaces

```env
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=nyc3
```

### Vercel Blob

```typescript
import { AlephaBucketVercel } from "@alepha/bucket-vercel";

alepha.with(AlephaBucketVercel);
```

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

### Azure Blob Storage

```typescript
import { AlephaBucketAzure } from "@alepha/bucket-azure";

alepha.with(AlephaBucketAzure);
```

```env
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
```

## Provider Selection by Platform

| Platform | Recommended Provider | Notes |
|----------|---------------------|-------|
| Vercel | Vercel Blob | Native integration, simple setup |
| Cloudflare | R2 (S3-compatible) | Edge-optimized, cost-effective |
| AWS | S3 | Native, full feature set |
| Self-hosted | MinIO | S3-compatible, runs anywhere |
| Any | Azure Blob | Good for Azure ecosystems |

## Multiple Providers

Use different providers for different buckets:

```typescript
import { $bucket } from "alepha/bucket";
import { AlephaBucketS3 } from "@alepha/bucket-s3";
import { AlephaBucketVercel } from "@alepha/bucket-vercel";

class Storage {
  // Temporary files in memory
  temp = $bucket({ name: "temp", provider: "memory" });

  // User uploads to Vercel Blob
  uploads = $bucket({ name: "uploads" }); // Uses default provider

  // Archives to S3
  archives = $bucket({ name: "archives" });
}

// Configure default provider
alepha.with(AlephaBucketVercel);
```

## Security Considerations

### Signed URLs

Generate time-limited URLs for private files:

```typescript
const url = await bucket.getSignedUrl(fileId, {
  expiresIn: 3600 // 1 hour
});
```

### MIME Type Validation

Restrict file types at upload:

```typescript
const images = $bucket({
  name: "images",
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  maxSize: 10 // 10 MB
});
```

### Public vs Private

Configure bucket access:

```typescript
const publicAssets = $bucket({
  name: "assets",
  public: true // Files are publicly accessible
});

const privateDocuments = $bucket({
  name: "documents",
  public: false // Requires signed URLs
});
```

## Migration Between Providers

To migrate files between providers:

```typescript
import { $command } from "alepha/command";

export const migrateFiles = $command({
  description: "Migrate files from S3 to Vercel Blob",
  handler: async ({ inject }) => {
    const oldBucket = inject(OldStorage).files;
    const newBucket = inject(NewStorage).files;

    const files = await oldBucket.list();

    for (const file of files) {
      const data = await oldBucket.download(file.id);
      await newBucket.upload(file.id, data, {
        contentType: file.contentType
      });
    }
  }
});
```
