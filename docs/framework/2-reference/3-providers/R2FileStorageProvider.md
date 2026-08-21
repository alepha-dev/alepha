# R2FileStorageProvider

## Import

```typescript
import { R2FileStorageProvider } from "alepha/bucket";
```

## Overview

Cloudflare R2 storage provider.

Uses a single R2 bucket binding for every container.
Files are organized as: {prefix}/{tenantId}/{container}/{fileId}

**Required environment variables:**

- `R2_BUCKET_NAME` - The actual R2 bucket name in Cloudflare

**Optional:**

- `S3_KEY_PREFIX` - Prefix for all files (for multi-app setups sharing one R2 bucket)
- `APP_NAME` - Fallback prefix when `S3_KEY_PREFIX` is unset
