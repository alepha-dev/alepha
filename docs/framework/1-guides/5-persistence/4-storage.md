# File Storage

`$storage` declares a named, constrained place to keep files. It works across
local disk, S3-compatible services, Cloudflare R2 and an in-memory backend for
tests.

```typescript check
import { $storage } from "alepha/api/files";
```

Every upload writes a row to the `files` table next to the blob. That row is
what makes listing, TTL expiry, tags, checksums and creator tracking possible -
so `$storage` lives in `alepha/api/files` and needs a database.

## Declaring a storage

```typescript check
import { $storage } from "alepha/api/files";

class MediaService {
  images = $storage({
    name: "user-images",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 5,
  });

  // Scratch files clean themselves up.
  temp = $storage({ ttl: [1, "day"], maxSize: 50 });
}
```

### Options

| Option        | Type                    | Default          | Description                                                            |
| ------------- | ----------------------- | ---------------- | ---------------------------------------------------------------------- |
| `name`        | `string`                | Property key     | Key prefix in the backend, and the `bucket` value on every `files` row |
| `mimeTypes`   | `string[]`              | any              | Allowed MIME types; anything else throws `InvalidFileError`            |
| `maxSize`     | `number`                | `10`             | Maximum size in **megabytes**                                          |
| `ttl`         | `DurationLike`          | none             | Default retention; files are purged after it elapses                   |
| `description` | `string`                | -                | Shown in devtools and the admin UI                                     |
| `provider`    | `Service` or `"memory"` | injected default | Override the backend for this storage                                  |

> `maxSize` is in megabytes. `maxSize: 5 * 1024 * 1024` is not "5 MB" - it is
> five million megabytes, i.e. no limit at all.

## A storage is a prefix, not a bucket

Every backend keys objects as `{prefix}/{tenantId}/{storage}/{fileId}` inside
**one** bucket (or one directory, on disk). Declaring twenty storages costs
nothing and provisions nothing - there is no per-storage cloud bucket and no
account bucket limit to worry about.

You create that one bucket yourself and point the provider at it
(`S3_BUCKET_NAME` / `R2_BUCKET_NAME`).

### Sharing one bucket between apps

`S3_KEY_PREFIX` sets the leading segment, so several apps can write into the
same bucket without seeing each other's keys:

```bash
S3_KEY_PREFIX=apps/myapp/production/blobs
```

`APP_NAME` is the fallback when it is unset, which is how this worked before
`S3_KEY_PREFIX` existed - already-deployed objects stay exactly where they are.

Prefer `S3_KEY_PREFIX` when a deployment platform sets the value for you.
`APP_NAME` also namespaces **cookies** and the `Server-Timing` header, so
changing it to lay out object storage renames every cookie and ends every
session as a side effect.

## Methods

### upload

```typescript
const stored = await this.images.upload(file, { user, tags: ["avatar"] });
stored.id; // ← the `files` row id: persist this, and use it in URLs
```

Returns the created `files` row. Validates MIME type and size first, then
writes the blob and the row. Not atomic - the blob is written before the row
because the row needs its id - so if the insert fails the blob is deleted
again, leaving nothing behind.

Per-upload options: `user`, `tags`, `ttl`, `expirationDate`.

### download

```typescript
const file = await this.images.download(stored.id);
```

Takes the row id, or an already-loaded row (which skips the lookup).

### list

```typescript
const page = await this.images.list({ tags: ["avatar"], size: 20 });
page.content; // FileEntity[]
page.page.totalElements; // total across all pages
```

A real paginated, filterable query against `files` - filter by `tags`, `name`,
`mimeType`, `creator` and a `createdAt` range. This is the thing raw blob
storage cannot do: a provider's `list()` is a flat, unfiltered, uncounted
listing capped at the backend's page size.

### get, exists, delete, deleteMany

```typescript
const row = await this.images.get(id);
const found = await this.images.exists(id);
await this.images.delete(id); // removes row + blob
await this.images.deleteMany([id1, id2]); // batched where supported
```

## Expiry

A storage-level `ttl` stamps `expirationDate` on every row it accepts. The
`api:files:purgeFiles` cron job (registered by `AlephaApiFiles`) sweeps expired
rows and deletes their blobs. Override per upload with `ttl`, or set an exact
`expirationDate`.

## Storage providers

The default depends on the environment:

- **Cloudflare Workers**: `R2FileStorageProvider` (`MemoryFileStorageProvider` under test) - the workerd bundle decides this first, so the rules below never apply there
- **Test**: `MemoryFileStorageProvider` (in-memory, lost on restart)
- **Otherwise**: `S3FileStorageProvider` when `S3_ENDPOINT` is set, else `LocalFileStorageProvider`

| Provider                    | Description                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `MemoryFileStorageProvider` | In-memory, for tests                                                            |
| `LocalFileStorageProvider`  | Local filesystem                                                                |
| `R2FileStorageProvider`     | Cloudflare R2 (Workers binding)                                                 |
| `S3FileStorageProvider`     | AWS S3 / MinIO / DigitalOcean Spaces / any S3-compatible service (via `s3mini`) |

Override globally:

```typescript
import { FileStorageProvider, S3FileStorageProvider } from "alepha/bucket";

const alepha = Alepha.create().with({
  provide: FileStorageProvider,
  use: S3FileStorageProvider,
});
```

Or per storage:

```typescript
class MediaService {
  images = $storage({ provider: S3FileStorageProvider });
  tempFiles = $storage({ provider: "memory" });
}
```

## Blobs without a database

`$storage` requires an ORM connection. If you genuinely need object storage
with no database, inject the provider directly:

```typescript
class Exports {
  protected readonly files = $inject(FileStorageProvider);

  async put(file: FileLike) {
    return this.files.upload("exports", file); // returns a blob id
  }
}
```

You get `upload` / `download` / `exists` / `delete` / `deleteMany` / `list`
against a container name you manage yourself - and no metadata, no expiry, no
querying, no HTTP endpoints. Reach for it only when a database is genuinely
unavailable.

## Testing

`MemoryFileStorageProvider` is the default under test:

```typescript
class TestApp {
  media = $storage({ name: "test-media" });
}

const app = alepha.inject(TestApp);
await alepha.start();

const stored = await app.media.upload(someFile);
expect(await app.media.exists(stored.id)).toBe(true);
expect((await app.media.list()).page.totalElements).toBe(1);
```
