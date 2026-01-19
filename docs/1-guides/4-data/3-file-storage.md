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

### Layer 2: `alepha/api/files` - Managed File Storage

The `AlephaApiFiles` module is a **superset** of `alepha/bucket`. It adds:
- Database persistence for file metadata (alepha/orm required)
- Time-to-live (TTL) with automatic cleanup
- Tags for organization
- Creator tracking (audit trail)
- Checksum calculation (SHA-256)
- Security access control
- Storage statistics
- REST API endpoints
- Admin UI integration

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";

const alepha = Alepha.create().with(AlephaApiFiles);

run(alepha);
```

---

> **Work in Progress**
>
> This guide is just getting started. We'll be adding more examples, storage provider configuration, and best practices soon. In the meantime, check out the [package reference](/docs/packages-alepha-bucket) for the full API.
