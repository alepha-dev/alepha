# @alepha/bucket-s3 - Bucket S3

## Installation

This module is part of the Alepha framework:

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

Custom S3 endpoint URL for S3-compatible services.
  
  Examples:
  - Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com
  - MinIO: http://localhost:9000
  - DigitalOcean Spaces: https://<region>.digitaloceanspaces.com
  
  Leave empty for AWS S3.
  /
  S3_ENDPOINT: t.optional(t.string()),

  /**
  AWS region or "auto" for R2.
  
  @default "us-east-1"
  /
  S3_REGION: t.optional(t.string()),

  /**
  Access key ID for S3 authentication.
  /
  S3_ACCESS_KEY_ID: t.string(),

  /**
  Secret access key for S3 authentication.
  /
  S3_SECRET_ACCESS_KEY: t.string(),

  /**
  Force path-style URLs (required for MinIO and some S3-compatible services).
  Set to "true" to enable.
  /
  S3_FORCE_PATH_STYLE: t.optional(t.string()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
S3-compatible storage implementation of File Storage Provider.

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.
