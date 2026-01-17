# @alepha/bucket-s3 - Bucket S3

## Installation

```bash
npm install @alepha/bucket-s3
```

## Overview

Plugin for Alepha Bucket that provides S3-compatible storage capabilities.

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### S3FileStorageProvider

S3-compatible storage implementation of File Storage Provider.

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `IO` | unknown | **Required** |  |
| `R2` | unknown | **Required** |  |
| `S3_ACCESS_KEY_ID` | string | **Required** |  |
| `S3_ENDPOINT` | string | - |  |
| `S3_FORCE_PATH_STYLE` | string | - |  |
| `S3_REGION` | string | - |  |
| `S3_SECRET_ACCESS_KEY` | string | **Required** |  |
