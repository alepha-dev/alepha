# S3FileStorageProvider

## Import

```typescript
import { S3FileStorageProvider } from "alepha/bucket";
```

## Overview

S3-compatible file storage provider for Node.js.

Backed by `s3mini` (zero-dep, ~20 KB). Works with AWS S3, Cloudflare R2,
MinIO, DigitalOcean Spaces, Backblaze B2, and any other S3-compatible service.

Uses path-style addressing (`<endpoint>/<S3_BUCKET_NAME>`), and keys every
object as `{APP_NAME}/{tenantId}/{container}/{fileId}` — the same scheme as
{@link R2FileStorageProvider}.

**Required environment variables:**
- `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`

**Optional:**
- `S3_REGION` (default `auto`), `APP_NAME` (prefix, for multi-app buckets)

Earlier versions created **one S3 bucket per container** and provisioned
them at boot. That capped container count at the account's bucket limit and
created infrastructure implicitly. The bucket is now yours to create; the
provider only writes keys into it.

