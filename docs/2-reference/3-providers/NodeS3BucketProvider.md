# NodeS3BucketProvider

## Import

```typescript
import { NodeS3BucketProvider } from "alepha/bucket";
```

## Overview

S3-compatible file storage provider for Node.js.

Backed by `s3mini` (zero-dep, ~20 KB). Works with AWS S3, Cloudflare R2,
MinIO, DigitalOcean Spaces, Backblaze B2, and any other S3-compatible service.

Uses path-style addressing (`<endpoint>/<bucket>`).

