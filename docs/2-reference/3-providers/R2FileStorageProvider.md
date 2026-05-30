# R2FileStorageProvider

## Import

```typescript
import { R2FileStorageProvider } from "alepha/bucket";
```

## Overview

Cloudflare R2 storage provider.

Uses a single R2 bucket binding for all $bucket primitives.
Files are organized as: {APP_NAME}/{bucketName}/{fileId}

**Required environment variables:**
- `R2_BUCKET_NAME` - The actual R2 bucket name in Cloudflare

**Optional (uses core Alepha env):**
- `APP_NAME` - Prefix for all files (for multi-app setups sharing one R2 bucket)

