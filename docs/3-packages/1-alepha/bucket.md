# Alepha - Bucket

## Installation

Part of the `alepha` package. Import from `alepha/bucket`.

```bash
npm install alepha
```

## Overview

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

- [`$bucket`](/docs/reference-primitives-$bucket) — Creates a bucket primitive for file storage and management with configurable validation.

### Providers

- [`CloudflareR2Provider`](/docs/reference-providers-cloudflarer2provider) — Cloudflare R2 storage provider.
- [`NodeS3BucketProvider`](/docs/reference-providers-nodes3bucketprovider) — S3-compatible file storage provider for Node.js.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `S3_ACCESS_KEY_ID` | string | **Required** |  |
| `S3_ENDPOINT` | string | **Required** |  |
| `S3_REGION` | string | - |  |
| `S3_SECRET_ACCESS_KEY` | string | **Required** |  |
