# Alepha - Bucket

## Installation

Part of the `alepha` package. Import from `alepha/bucket`.

```bash
npm install alepha
```

## Overview

Raw blob storage. **Not the application-facing API.**

There is no bucket primitive. Declare file storage with `$storage`
(`alepha/api/files`), which pairs every blob with a `files` row and so can
offer paginated listing, TTL expiry, tags, checksums, creator tracking and
HTTP endpoints.

Inject `FileStorageProvider` directly only when you need blobs *without* a
database - you get `upload` / `download` / `delete` / `deleteMany` /
`exists` / `list`, keyed by a container name you manage yourself, and
nothing else.

All backends treat the container name as a **key prefix inside one bucket**
(`{prefix}/{tenantId}/{container}/{fileId}` - the leading prefix comes from
`S3_KEY_PREFIX`, or `APP_NAME` as a fallback, and the tenant segment appears
when a tenant is active) or one directory on disk - never a separate cloud
bucket per container.

**Providers:** Memory (testing), Local filesystem, S3-compatible
(AWS/MinIO), Cloudflare R2.

## API Reference

### Providers

- [`FileStorageProvider`](/docs/reference-providers-filestorageprovider) - Abstract contract for raw blob storage.
- [`LocalFileStorageProvider`](/docs/reference-providers-localfilestorageprovider) - Filesystem-backed blob storage - the Node default when `S3_ENDPOINT` is
- [`MemoryFileStorageProvider`](/docs/reference-providers-memoryfilestorageprovider) - In-memory blob storage, bound automatically under test. The `files` map is
- [`R2FileStorageProvider`](/docs/reference-providers-r2filestorageprovider) - Cloudflare R2 storage provider.
- [`S3FileStorageProvider`](/docs/reference-providers-s3filestorageprovider) - S3-compatible file storage provider for Node.js.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `S3_ACCESS_KEY_ID` | string | **Required** |  |
| `S3_BUCKET_NAME` | string | **Required** |  |
| `S3_ENDPOINT` | string | **Required** |  |
| `S3_KEY_PREFIX` | string | - |  |
| `S3_REGION` | string | - |  |
| `S3_SECRET_ACCESS_KEY` | string | **Required** |  |
