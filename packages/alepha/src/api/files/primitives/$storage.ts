import {
  $inject,
  createPrimitive,
  type FileLike,
  KIND,
  Primitive,
  type Service,
} from "alepha";
import { FileStorageProvider, MemoryFileStorageProvider } from "alepha/bucket";
import type { DateTime, DurationLike } from "alepha/datetime";
import type { Page } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import type { FileEntity } from "../entities/files.ts";
import type { FileQuery } from "../schemas/fileQuerySchema.ts";
import { FileService } from "../services/FileService.ts";

/**
 * Declares a named, constrained place to keep files.
 *
 * A storage is a logical partition — a prefix inside one cloud bucket, or one
 * directory on disk. It is **not** a cloud bucket per storage: `S3`, `R2` and
 * the local filesystem all key objects as
 * `{APP_NAME}/{tenantId}/{storage}/{fileId}` (tenant segment when a tenant is
 * active).
 *
 * Every upload writes a row to the `files` table alongside the blob, which is
 * what makes {@link StoragePrimitive.list} a real paginated query, and what
 * makes `ttl`, `tags` and creator tracking work at all. That is why `$storage`
 * lives in `alepha/api/files` and needs an ORM connection.
 *
 * **Need blobs without a database?** Inject `FileStorageProvider` from
 * `alepha/bucket` directly. You get `upload`/`download`/`delete`/`list`
 * against S3, R2 or disk, and you give up metadata, expiry, querying and the
 * HTTP endpoints.
 *
 * @example
 * ```ts
 * class Media {
 *   avatars = $storage({
 *     mimeTypes: ["image/jpeg", "image/png", "image/webp"],
 *     maxSize: 2,
 *   });
 *
 *   // Temporary uploads clean themselves up.
 *   scratch = $storage({ ttl: [1, "day"], maxSize: 50 });
 *
 *   async setAvatar(file: FileLike, user: UserAccountToken) {
 *     const stored = await this.avatars.upload(file, { user });
 *     return stored.id;
 *   }
 * }
 * ```
 */
export const $storage = (options: StoragePrimitiveOptions = {}) =>
  createPrimitive(StoragePrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface StoragePrimitiveOptions {
  /**
   * Unique name for this storage. Becomes the key prefix in the backend and
   * the `bucket` discriminator on every `files` row.
   *
   * Defaults to the property key it is declared on.
   *
   * @example "avatars"
   * @example "petition-attachments"
   */
  name?: string;

  /**
   * Human-readable purpose, surfaced in devtools and the admin UI.
   */
  description?: string;

  /**
   * Allowed MIME types. An upload with any other type is rejected with
   * `InvalidFileError`.
   *
   * MIME types are client-supplied and trivially spoofed — treat this as a
   * usability guard, not a security control.
   *
   * @example ["image/jpeg", "image/png"]
   */
  mimeTypes?: string[];

  /**
   * Maximum file size in **megabytes**. Larger uploads are rejected with
   * `InvalidFileError`.
   *
   * @default 10
   */
  maxSize?: number;

  /**
   * Default lifetime for files placed here. The expiry is stored per row as
   * `expirationDate`; a cron job (`api:files:purgeFiles`) deletes rows and
   * blobs once they are past it.
   *
   * Override per upload with `upload(file, { ttl })`.
   *
   * @example [7, "days"]
   */
  ttl?: DurationLike;

  /**
   * Storage backend.
   *
   * - `"memory"` — in-process, lost on restart (tests)
   * - a `FileStorageProvider` subclass — e.g. `S3FileStorageProvider`
   * - omitted — the injected default for the environment
   */
  provider?: Service<FileStorageProvider> | "memory";

  /**
   * This interface is **open for augmentation**: a package that adds an
   * upload-time concern declares its own option here rather than getting a
   * field reserved for it in core. Pair it with a `files:beforeUpload`
   * subscriber that reads `storage.options` and acts on it, and core carries
   * neither the option nor the dependency behind it.
   *
   * ```ts
   * declare module "alepha/api/files" {
   *   interface StoragePrimitiveOptions {
   *     image?: { maxWidth: number };
   *   }
   * }
   * ```
   *
   * Installing such a package makes the option available, typed, at every
   * `$storage({ ... })` call site with no import — and uninstalling it stops
   * those call sites compiling, which is the honest outcome, since the option
   * would no longer do anything.
   */
}

// ---------------------------------------------------------------------------------------------------------------------

export interface StorageUploadOptions {
  /**
   * Who uploaded this. Recorded on the row for audit and ownership checks.
   */
  user?: UserAccountToken;

  /**
   * Free-form labels, queryable via `list({ tags })`.
   */
  tags?: string[];

  /**
   * Lifetime for this file, overriding the storage's `ttl`.
   */
  ttl?: DurationLike;

  /**
   * Exact expiry instant. Takes precedence over `ttl`.
   */
  expirationDate?: string | DateTime;
}

// ---------------------------------------------------------------------------------------------------------------------

export class StoragePrimitive extends Primitive<StoragePrimitiveOptions> {
  /**
   * Megabytes a storage takes when it declares no {@link
   * StoragePrimitiveOptions.maxSize}.
   *
   * Here rather than repeated as a default parameter, because three places
   * needed it and one of them did not have it: the transport deferred to the
   * application-wide 5 MB, so a bucket that declared nothing was held at half
   * what this primitive documents.
   */
  public static readonly DEFAULT_MAX_SIZE_MB = 10;

  public readonly provider = this.$provider();

  protected readonly fileService = $inject(FileService);

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * The size ceiling for this storage, in megabytes, declared or default.
   */
  public get maxSize(): number {
    return this.options.maxSize ?? StoragePrimitive.DEFAULT_MAX_SIZE_MB;
  }

  /**
   * Stores the bytes and records the metadata row.
   *
   * Returns the `files` row, so `.id` is the value to persist in your own
   * tables and to hand to `GET /api/files/:id`. (The `blobId` is a storage
   * detail you should not need.)
   *
   * Not atomic: the blob is written first because the row needs its id. If
   * the insert then fails the blob is deleted, so a failure leaves nothing
   * behind rather than an orphan.
   */
  public upload(
    file: FileLike,
    options: StorageUploadOptions = {},
  ): Promise<FileEntity> {
    return this.fileService.uploadFile(file, { ...options, storage: this });
  }

  /**
   * Reads a file back by its row id.
   */
  public download(id: string | FileEntity): Promise<FileLike> {
    return this.fileService.streamFile(id);
  }

  /**
   * Fetches the metadata row without touching the blob.
   */
  public get(id: string): Promise<FileEntity> {
    return this.fileService.getFileById(id);
  }

  /**
   * Removes both the row and the blob.
   */
  public async delete(id: string): Promise<void> {
    await this.fileService.deleteFile(id);
  }

  /**
   * Removes many files, batching the backend calls where the provider
   * supports it (R2/S3, up to 1000 keys per request).
   */
  public async deleteMany(ids: string[]): Promise<string[]> {
    return this.fileService.deleteFiles(ids);
  }

  /**
   * True when a row for this id exists in this storage.
   */
  public exists(id: string): Promise<boolean> {
    return this.fileService.fileExists(id, this.name);
  }

  /**
   * Paginated, filterable listing of this storage's files — a real query
   * against the `files` table.
   *
   * This is the piece raw blob storage cannot give you: `FileStorageProvider`
   * only offers a flat listing capped at the backend's page size (~1000),
   * with no filtering, ordering or total count.
   */
  public list(
    query: Omit<FileQuery, "bucket"> = {},
  ): Promise<Page<FileEntity>> {
    return this.fileService.findFiles({ ...query, bucket: this.name });
  }

  protected $provider(): FileStorageProvider {
    if (!this.options.provider) {
      return this.alepha.inject(FileStorageProvider);
    }
    if (this.options.provider === "memory") {
      return this.alepha.inject(MemoryFileStorageProvider);
    }
    return this.alepha.inject(this.options.provider);
  }
}

$storage[KIND] = StoragePrimitive;
