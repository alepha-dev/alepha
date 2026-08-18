# $storage

## Import

```typescript
import { $storage } from "alepha/api/files";
```

## Overview

Declares a named, constrained place to keep files.

A storage is a logical partition — a prefix inside one cloud bucket, or one
directory on disk. It is **not** a cloud bucket per storage: `S3`, `R2` and
the local filesystem all key objects as
`{APP_NAME}/{tenantId}/{storage}/{fileId}` (tenant segment when a tenant is
active).

Every upload writes a row to the `files` table alongside the blob, which is
what makes {@link StoragePrimitive.list} a real paginated query, and what
makes `ttl`, `tags` and creator tracking work at all. That is why `$storage`
lives in `alepha/api/files` and needs an ORM connection.

**Need blobs without a database?** Inject `FileStorageProvider` from
`alepha/bucket` directly. You get `upload`/`download`/`delete`/`list`
against S3, R2 or disk, and you give up metadata, expiry, querying and the
HTTP endpoints.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Unique name for this storage |
| `description` | `string` | No | Human-readable purpose, surfaced in devtools and the admin UI. |
| `mimeTypes` | `string[]` | No | Allowed MIME types |
| `maxSize` | `number` | No | Maximum file size in **megabytes** |
| `ttl` | `DurationLike` | No | Default lifetime for files placed here |
| `provider` | `Service&lt;FileStorageProvider&gt; \| "memory"` | No | Storage backend |

## Examples

```ts
class Media {
  avatars = $storage({
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 2,
  });

  // Temporary uploads clean themselves up.
  scratch = $storage({ ttl: [1, "day"], maxSize: 50 });

  async setAvatar(file: FileLike, user: UserAccountToken) {
    const stored = await this.avatars.upload(file, { user });
    return stored.id;
  }
}
```

