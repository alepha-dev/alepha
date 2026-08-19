# FileStorageProvider

## Import

```typescript
import { FileStorageProvider } from "alepha/bucket";
```

## Overview

Abstract contract for raw blob storage.

Inject it to upload, download and delete blobs by bucket + file id. Which
implementation answers depends on the environment: R2 on Cloudflare Workers,
S3 when `S3_ENDPOINT` is set, the local filesystem otherwise, and memory
under test. Application-facing file storage is declared with `$storage`
(`alepha/api/files`), which layers metadata and TTLs on top of this.

