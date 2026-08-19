# LocalFileStorageProvider

## Import

```typescript
import { LocalFileStorageProvider } from "alepha/bucket";
```

## Overview

Filesystem-backed blob storage - the Node default when `S3_ENDPOINT` is
unset. Blobs live under `STORAGE_PATH` (falling back to `DATA_DIR`), which
must sit outside the deployed bundle so uploads survive a redeploy.

