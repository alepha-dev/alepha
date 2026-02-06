# Alepha - Bucket

## Installation

Part of the `alepha` package. Import from `alepha/bucket`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.9.0 | node, bun, workerd|

Unified file storage abstraction across multiple backends.

**Features:**
- File storage buckets with constraints
- Unified API across all storage backends
- MIME type validation
- File size limits
- Upload/download/delete operations
- TTL-based file expiration
- Providers: Memory (testing), Local filesystem, AWS S3 / Cloudflare R2 / MinIO, Azure Blob Storage, Vercel Blob

## API Reference

### Primitives

- [`$bucket`](/docs/primitives-$bucket) — Creates a bucket primitive for file storage and management with configurable validation.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### CloudflareR2Provider

Cloudflare R2 storage provider.

Uses a single R2 bucket binding for all $bucket primitives.
Files are organized as: {APP_NAME}/{bucketName}/{fileId}

**Required environment variables:**
- `R2_BUCKET_NAME` - The actual R2 bucket name in Cloudflare

**Optional (uses core Alepha env):**
- `APP_NAME` - Prefix for all files (for multi-app setups sharing one R2 bucket)
