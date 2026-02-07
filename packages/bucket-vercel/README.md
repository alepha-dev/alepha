# Alepha @alepha/bucket Vercel

Vercel Blob Storage implementation for the bucket file storage.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Vercel Blob Storage provider.

**Features:**
- Serverless-optimized storage
- Vercel deployment integration

## API Reference

### Providers

- [`VercelFileStorageProvider`](https://alepha.dev/docs/reference-providers-vercelfilestorageprovider) — Vercel Blob Storage implementation of File Storage Provider.

### Environment Variables

Environment variables used to configure this package.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BLOB_READ_WRITE_TOKEN` | text | **Required** |  |
