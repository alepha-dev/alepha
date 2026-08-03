# Alepha - Api Files

## Installation

Part of the `alepha` package. Import from `alepha/api/files`.

```bash
npm install alepha
```

## Overview

File storage with metadata: the `$storage` primitive plus the endpoints,
querying and retention that a database makes possible.

Declare a place to keep files with `$storage`. Every upload writes a `files`
row next to the blob, which is what powers paginated listing, TTL expiry,
tags, checksums and creator tracking.

```ts
class Media {
  avatars = $storage({ mimeTypes: ["image/png"], maxSize: 2 });
}

const stored = await this.avatars.upload(file, { user });
stored.id; // hand this to GET /api/files/:id
```

**Features:**
- `$storage` primitive with MIME/size constraints and default TTL
- Upload/download HTTP endpoints, ETag-aware
- Paginated, filterable file queries
- TTL-based expiration swept by `api:files:purgeFiles`
- Storage statistics for the admin UI

Blobs *without* a database are a `FileStorageProvider` concern — see
`alepha/bucket`.

## API Reference

### Primitives

- [`$storage`](/docs/reference-primitives-$storage) — Declares a named, constrained place to keep files.

### Providers

- [`DefaultStorage`](/docs/reference-providers-defaultstorage) — The `default` storage.
- [`FileAccessProvider`](/docs/reference-providers-fileaccessprovider) — Authorization policy for file reads served through `FileController.streamFile`.
- [`StorageMultipartCapProvider`](/docs/reference-providers-storagemultipartcapprovider) — Lets the targeted `$storage` decide how many bytes a request may carry.
