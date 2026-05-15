# Alepha - Api Files

## Installation

Part of the `alepha` package. Import from `alepha/api/files`.

```bash
npm install alepha
```

## Overview

File management endpoints.

**Features:**
- Upload/download endpoints
- File metadata storage
- TTL-based expiration
- Storage statistics

## API Reference

### Providers

- [`FileAccessProvider`](/docs/reference-providers-fileaccessprovider) — Authorization policy for file reads served through `FileController.streamFile`.
