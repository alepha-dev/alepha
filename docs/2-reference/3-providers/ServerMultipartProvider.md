# ServerMultipartProvider

## Import

```typescript
import { ServerMultipartProvider } from "alepha/server";
```

## Overview

Parses `multipart/form-data` request bodies into route handler input.

**This provider buffers.** It reads the entire request body into memory via
`request.formData()` before the handler runs, and each file field is handed
to the handler as an in-memory, `Blob`-backed `FileLike`. It does **not**
stream uploads to the storage layer — by the time `bucket.upload` runs, the
bytes are already fully in RAM.

This is a deliberate trade-off, kept safe by the `multipartOptions` limits
(default 5 MB/file, 10 MB total, 10 files): the framework targets small
uploads (avatars, attachments, documents), so buffering keeps validation
simple and exact (`blob.size` is known up front) without a streaming
multipart parser. If you need large-file uploads, raise those limits only
alongside a streaming parser — buffering 100 MB per request will exhaust
memory (and blow the Workers memory ceiling).

