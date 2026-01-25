# Alepha @alepha/bucket S3

S3-compatible storage implementation for the bucket file storage. Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and more.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

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

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](https://feunard.github.io/alepha/).

#### S3FileStorageProvider

S3-compatible storage implementation of File Storage Provider.

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.

### Environment Variables

Environment variables used to configure this package.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `S3_ACCESS_KEY_ID` | string | **Required** |  |
| `S3_ENDPOINT` | string | - |  |
| `S3_FORCE_PATH_STYLE` | string | - |  |
| `S3_REGION` | string | - |  |
| `S3_SECRET_ACCESS_KEY` | string | **Required** |  |
