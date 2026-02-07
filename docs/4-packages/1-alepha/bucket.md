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

- [`$bucket`](/docs/reference-primitives-$bucket) — Creates a bucket primitive for file storage and management with configurable validation.

### Providers

- [`CloudflareR2Provider`](/docs/reference-providers-cloudflarer2provider) — Cloudflare R2 storage provider.
