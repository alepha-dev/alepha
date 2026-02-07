# @alepha/bucket-s3 - Bucket S3

## Installation

```bash
npm install @alepha/bucket-s3
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

S3-compatible file storage provider.

**Features:**
- AWS S3 compatibility
- Cloudflare R2 compatibility
- MinIO compatibility
- DigitalOcean Spaces compatibility
- Any S3-compatible backend

## API Reference

### Providers

- [`S3FileStorageProvider`](/docs/reference-providers-s3filestorageprovider) — S3-compatible storage implementation of File Storage Provider.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `S3_ACCESS_KEY_ID` | string | **Required** |  |
| `S3_ENDPOINT` | string | - |  |
| `S3_FORCE_PATH_STYLE` | string | - |  |
| `S3_REGION` | string | - |  |
| `S3_SECRET_ACCESS_KEY` | string | **Required** |  |
