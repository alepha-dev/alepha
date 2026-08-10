import { createHash } from "node:crypto";
import { $inject, Alepha, type FileLike } from "alepha";
import {
  FileNotFoundError,
  FileTooLargeError,
  InvalidFileError,
} from "alepha/bucket";
import {
  type DateTime,
  DateTimeProvider,
  type DurationLike,
} from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page, RepositoryProvider } from "alepha/orm";
import type { Ok } from "alepha/server";
import { NotFoundError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { type FileEntity, files } from "../entities/files.ts";
import {
  $storage,
  type StoragePrimitive,
  type StorageUploadOptions,
} from "../primitives/$storage.ts";
import type { FileQuery } from "../schemas/fileQuerySchema.ts";
import type { FileResource } from "../schemas/fileResourceSchema.ts";
import type { StorageStats } from "../schemas/storageStatsSchema.ts";

/**
 * Default storage name used when a caller does not name one (e.g. the HTTP
 * upload endpoint's optional `bucket` field).
 */
export const DEFAULT_STORAGE = "default";

export class FileService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly repositoryProvider = $inject(RepositoryProvider);
  protected readonly fileSystem = $inject(FileSystemProvider);
  public readonly fileRepository = $repository(files);

  /**
   * Best-effort left join embedding the uploader on every file row, so the
   * admin UI can render `user.email` instead of the bare `creator` UUID.
   * Joins `files.creator` → `users.id`. Only applied when the `users` table is
   * actually registered in the app (see `findFiles`) — the files module stays
   * usable standalone, without `alepha/api/users`. Targets the default `users`
   * table, so creators in non-default realms come back unmatched (`user`
   * undefined), which the UI handles by falling back to `creatorName`.
   *
   * The `users` entity is resolved from the repository registry at runtime
   * rather than imported: the users module already depends on the files module
   * (avatars), so a compile-time import here would form a circular dependency.
   */
  protected resolveCreatorJoin() {
    const usersEntity = this.repositoryProvider
      .getRepositories()
      .find((repo) => repo.entity.name === "users")?.entity;
    if (!usersEntity) {
      return undefined;
    }
    return {
      user: {
        join: usersEntity,
        on: ["creator", usersEntity.cols.id] as ["creator", { name: string }],
      },
    };
  }

  /**
   * Calculates the SHA-256 checksum of an already-read body.
   *
   * @param data - The file bytes
   * @returns Hexadecimal string representation of the SHA-256 hash
   * @protected
   */
  protected hashBuffer(data: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(data)).digest("hex");
  }

  /**
   * Resolves a declared `$storage` by name.
   *
   * @param name - Storage name, defaulting to {@link DEFAULT_STORAGE}
   * @throws {NotFoundError} When no storage with that name is declared
   */
  public storage(name: string = DEFAULT_STORAGE): StoragePrimitive {
    const storage = this.alepha
      .primitives($storage)
      .find((it) => it.name === name);

    if (!storage) {
      throw new NotFoundError(`Storage '${name}' not found.`);
    }

    return storage;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Finds files matching the given query criteria with pagination support.
   * Supports filtering by bucket, tags, name, mimeType, creator, and date range.
   *
   * @param q - Query parameters including bucket, tags, name, mimeType, creator, date range, pagination, and sorting
   * @returns Paginated list of file entities
   */
  public async findFiles(q: FileQuery = {}): Promise<Page<FileEntity>> {
    q.sort ??= "-createdAt";

    const where = this.fileRepository.createQueryWhere();

    if (q.bucket) {
      where.bucket = { eq: q.bucket };
    }

    if (q.tags) {
      where.tags = { arrayContains: q.tags };
    }

    if (q.name) {
      where.name = { ilike: `%${q.name}%` };
    }

    if (q.mimeType) {
      where.mimeType = { eq: q.mimeType };
    }

    if (q.creator) {
      where.creator = { eq: q.creator };
    }

    if (q.createdAfter && q.createdBefore) {
      where.createdAt = {
        gte: q.createdAfter,
        lte: q.createdBefore,
      };
    } else if (q.createdAfter) {
      where.createdAt = { gte: q.createdAfter };
    } else if (q.createdBefore) {
      where.createdAt = { lte: q.createdBefore };
    }

    // The creator join requires the `users` table. Only opt in when a users
    // repository is registered (i.e. `alepha/api/users` is loaded) so the
    // files module — and its standalone tests — keep working without it.
    const withCreator = this.resolveCreatorJoin();

    return await this.fileRepository
      .paginate(
        q,
        { where, ...(withCreator ? { with: withCreator } : {}) },
        { count: true },
      )
      .then((page) => {
        return {
          ...page,
          content: page.content.map((it) => this.entityToResource(it)),
        };
      });
  }

  /**
   * Finds files that have expired based on their expiration date.
   * Limited to 1000 files per call to prevent memory issues.
   *
   * @returns Array of expired file entities
   */
  public async findExpiredFiles(): Promise<FileEntity[]> {
    return await this.fileRepository.findMany({
      limit: 1000,
      where: {
        expirationDate: { lte: this.dateTimeProvider.nowISOString() },
      },
    });
  }

  /**
   * Calculates an expiration date based on a TTL (time to live) duration.
   *
   * @param ttl - Duration like "1 day", "2 hours", etc.
   * @returns DateTime representation of the expiration date, or undefined if no TTL provided
   * @protected
   */
  protected getExpirationDate(ttl?: DurationLike): string | undefined {
    return ttl
      ? this.dateTimeProvider
          .now()
          .add(this.dateTimeProvider.duration(ttl))
          .toISOString()
      : undefined;
  }

  /**
   * Uploads a file to a bucket and creates a database record with metadata.
   * Automatically calculates and stores the file checksum (SHA-256).
   *
   * @param file - The file to upload
   * @param options - Upload options including bucket, expiration, user, and tags
   * @param options.bucket - Target bucket name (defaults to "default")
   * @param options.expirationDate - When the file should expire
   * @param options.user - User performing the upload (for audit trail)
   * @param options.tags - Tags to associate with the file
   * @returns The created file entity with all metadata
   * @throws {NotFoundError} If the specified bucket doesn't exist
   */
  public async uploadFile(
    file: FileLike,
    options: StorageUploadOptions & {
      /**
       * Target storage. Pass the primitive directly (what `$storage.upload`
       * does) or a name to resolve.
       */
      storage?: StoragePrimitive;
      bucket?: string;
    } = {},
  ): Promise<FileEntity> {
    const storage = options.storage ?? this.storage(options.bucket);

    // Three consumers want these bytes — the checksum, the size and MIME
    // checks, and the provider — and a one-shot stream serves exactly one.
    //
    // A file whose length is already known is read once into a buffer and all
    // three read from it: reading twice would either hash the wrong thing or
    // store an empty blob. A file whose length is not known cannot afford that
    // buffer, so it makes a single pass and the size is learned on the way
    // through.
    let checksum: string | undefined;
    let streamedSize: number | undefined;
    let blobId: string;

    // A declared size is trusted only as a hint about which path to take; the
    // decision is made by reading. Everything short enough is buffered, which
    // keeps the checksum and the exact size that small uploads have always
    // had. Only what overflows the threshold gives them up, and only because
    // the alternative is holding it all in memory to find out.
    const peek =
      file.size > 0 && file.size <= FileService.BUFFER_THRESHOLD
        ? { buffered: new Uint8Array(await file.arrayBuffer()) }
        : await this.readUpTo(file, FileService.BUFFER_THRESHOLD);

    if ("buffered" in peek) {
      const data = peek.buffered;
      file = this.fileSystem.createFile({
        arrayBuffer: data.buffer as ArrayBuffer,
        name: file.name,
        type: file.type,
      });

      this.assertAllowed(file, storage);

      // Ahead of the checksum, because a subscriber that rewrites the bytes
      // must have the row describe what was actually stored — hashing first
      // would pin the checksum, the size and the MIME type to a file nobody can
      // fetch. After `assertAllowed`, so an oversized upload is refused before
      // any subscriber spends work on it.
      //
      // Only this branch. The streaming path below never holds the whole file,
      // and a subscriber that cannot see the bytes cannot transform them.
      const ev = { file, storage };
      await this.alepha.events.emit("files:beforeUpload", ev);
      file = ev.file;

      checksum = this.hashBuffer(await file.arrayBuffer());
      blobId = await storage.provider.upload(storage.name, file);
    } else {
      // MIME is known from the headers, so it is still checked up front. Size
      // cannot be: it is counted as the bytes go by, which is stricter than the
      // old check — that one trusted whatever `size` the caller reported.
      this.assertMimeAllowed(file, storage);

      const counter = { size: 0 };
      blobId = await storage.provider.upload(
        storage.name,
        this.counting(
          this.rejoined(file, peek.head, peek.rest),
          storage,
          counter,
        ),
      );
      streamedSize = counter.size;

      // ⚠️ No checksum for a streamed upload, deliberately. There is no
      // streaming digest on workerd — `crypto.subtle.digest` wants the whole
      // buffer — so producing one would mean buffering the payload, which is
      // the single thing this path exists to avoid. The column is optional; a
      // wrong hash would be worse than none.
    }

    let expirationDate: string | undefined;
    if (options.expirationDate) {
      expirationDate = this.dateTimeProvider
        .of(options.expirationDate)
        .toISOString();
    } else if (options.ttl) {
      expirationDate = this.getExpirationDate(options.ttl);
    } else if (storage.options.ttl) {
      expirationDate = this.getExpirationDate(storage.options.ttl);
    }

    return await this.persistBlobMetadata(storage, blobId, () =>
      this.fileRepository.create({
        blobId: blobId,
        mimeType: file.type,
        name: file.name,
        originalName: file.name,
        size: streamedSize ?? file.size,
        creator: options.user?.id,
        creatorRealm: options.user?.realm,
        creatorName: options.user?.name,
        expirationDate,
        bucket: storage.name,
        tags: options.tags,
        checksum,
      }),
    );
  }

  /**
   * Enforces the storage's MIME and size constraints.
   *
   * Runs against a materialized buffer, so `file.size` is always the real
   * byte count. A streamed body reports `size === 0` until read, which is how
   * the size cap used to be bypassed.
   */
  /**
   * How much of an unknown-length upload is read before giving up on buffering.
   *
   * Below it, an upload keeps everything it used to have — an exact size and a
   * checksum — because it fits. Above it, those are traded for not holding the
   * payload. Ten megabytes is the application-wide multipart default: the size
   * the framework already considered safe to hold.
   */
  protected static readonly BUFFER_THRESHOLD = 10 * 1024 * 1024;

  /**
   * Reads a file until it ends or outgrows `limit`.
   *
   * Returns the whole thing when it fits, and otherwise what was read plus the
   * rest of the stream — so nothing is consumed twice and nothing is lost. The
   * bug this shape avoids is the one its regression test names: draining a
   * one-shot stream for a checksum, then handing the drained stream to the
   * bucket and storing an empty blob.
   */
  protected async readUpTo(
    file: FileLike,
    limit: number,
  ): Promise<
    | { buffered: Uint8Array }
    | { head: Uint8Array[]; rest: AsyncIterator<Uint8Array> }
  > {
    const iterator = (file.stream() as AsyncIterable<Uint8Array | Buffer>)[
      Symbol.asyncIterator
    ]();
    const head: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const next = await iterator.next();
      if (next.done) {
        const buffered = new Uint8Array(size);
        let at = 0;
        for (const chunk of head) {
          buffered.set(chunk, at);
          at += chunk.length;
        }
        return { buffered };
      }
      const chunk =
        next.value instanceof Uint8Array
          ? next.value
          : new Uint8Array(next.value);
      head.push(chunk);
      size += chunk.length;
      if (size > limit) {
        return { head, rest: iterator };
      }
    }
  }

  /**
   * Puts a partly-read file back together, without re-reading what was taken.
   */
  protected rejoined(
    file: FileLike,
    head: Uint8Array[],
    rest: AsyncIterator<Uint8Array>,
  ): FileLike {
    return {
      ...file,
      size: 0,
      stream: () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const chunk of head) {
              controller.enqueue(chunk);
            }
            while (true) {
              const next = await rest.next();
              if (next.done) {
                break;
              }
              controller.enqueue(next.value);
            }
            controller.close();
          },
        }) as never,
    };
  }

  /**
   * Wraps a file so its bytes are counted, and refused, as they pass.
   *
   * The cap used to be a comparison against `file.size` — a number the caller
   * supplied. A stream reports 0 there, which is precisely how the limit was
   * bypassed (see the note this replaces). Counting cannot be lied to.
   *
   * ⚠️ The refusal lands mid-transfer, so the backend may hold a partial
   * object. That is the price of not buffering, and it is the lesser harm: the
   * alternative is holding the whole payload in memory to find out it was too
   * big. The transport layer has already applied its own ceiling before this
   * one is reached, so getting here at all means two limits disagreed.
   */
  protected counting(
    file: FileLike,
    storage: StoragePrimitive,
    counter: { size: number },
  ): FileLike {
    const { maxSize } = storage;
    const ceiling = maxSize * 1024 * 1024;
    const source = file;

    return {
      ...file,
      size: 0,
      stream: () => {
        const upstream = source.stream() as AsyncIterable<Uint8Array>;
        return new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of upstream) {
                counter.size += chunk.length;
                if (counter.size > ceiling) {
                  throw new FileTooLargeError(
                    `File exceeds the maximum size of ${maxSize} MB in storage ${storage.name}`,
                  );
                }
                controller.enqueue(chunk);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }) as never;
      },
      arrayBuffer: async () => {
        throw new InvalidFileError(
          `Storage ${storage.name} received a streamed upload and cannot buffer it`,
        );
      },
    };
  }

  /**
   * Checks the MIME type alone, for a file whose size is not yet known.
   */
  protected assertMimeAllowed(file: FileLike, storage: StoragePrimitive): void {
    const { mimeTypes } = storage.options;
    if (!mimeTypes) {
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    if (!mimeTypes.includes(mimeType)) {
      throw new InvalidFileError(
        `MIME type ${mimeType} is not allowed in storage ${storage.name}`,
      );
    }
  }

  protected assertAllowed(file: FileLike, storage: StoragePrimitive): void {
    const { mimeTypes } = storage.options;
    const { maxSize } = storage;

    if (mimeTypes) {
      const mimeType = file.type || "application/octet-stream";
      if (!mimeTypes.includes(mimeType)) {
        throw new InvalidFileError(
          `MIME type ${mimeType} is not allowed in storage ${storage.name}`,
        );
      }
    }

    if (file.size > maxSize * 1024 * 1024) {
      throw new FileTooLargeError(
        `File size ${file.size} exceeds the maximum size of ${maxSize} MB in storage ${storage.name}`,
      );
    }
  }

  /**
   * True when a row with this id exists, optionally scoped to one storage.
   */
  public async fileExists(id: string, storageName?: string): Promise<boolean> {
    const where = this.fileRepository.createQueryWhere();
    where.id = { eq: id };
    if (storageName) {
      where.bucket = { eq: storageName };
    }
    const rows = await this.fileRepository.findMany({
      where,
      limit: 1,
      columns: ["id"],
    });
    return rows.length > 0;
  }

  /**
   * Persists the metadata row for an already-uploaded blob, deleting the
   * blob if the insert fails. Uploads are not atomic: the blob is written to
   * storage first (the row needs the returned `blobId`), so a failed insert
   * would otherwise leak the blob — an orphaned blob with no DB row. This
   * compensates by removing the blob, favouring the recoverable failure
   * (a missing blob) over the worse one (a row pointing at nothing).
   *
   * Best-effort: cleanup runs with `skipHook` so it neither re-emits
   * cleanup is logged rather than thrown. The original write error is always
   * rethrown so callers still see the real failure.
   *
   * @param storage - The storage the blob was uploaded to
   * @param blobId - The id returned by the provider's `upload`
   * @param insert - Thunk performing the metadata insert
   * @returns The created file entity
   */
  protected async persistBlobMetadata(
    storage: StoragePrimitive,
    blobId: string,
    insert: () => Promise<FileEntity>,
  ): Promise<FileEntity> {
    try {
      return await insert();
    } catch (error) {
      await storage.provider
        .delete(storage.name, blobId)
        .catch((cleanupError: unknown) => {
          this.log.warn(
            `Failed to remove orphaned blob ${blobId} from storage ${storage.name} after a metadata write failure`,
            cleanupError,
          );
        });
      throw error;
    }
  }

  /**
   * Streams a file from storage by its database ID, or directly from an
   * already-loaded `FileEntity` to avoid a duplicate DB roundtrip when the
   * caller has already fetched the row (e.g. after an access check).
   *
   * @param id - The database ID (UUID) of the file, or the entity itself
   * @returns The file object ready for streaming/downloading
   * @throws {NotFoundError} If the file doesn't exist in the database
   * @throws {FileNotFoundError} If the file exists in database but not in storage
   */
  public async streamFile(id: string | FileEntity): Promise<FileLike> {
    const entity = await this.getFileById(id);
    const storage = this.storage(entity.bucket);

    return await storage.provider.download(storage.name, entity.blobId);
  }

  /**
   * Updates file metadata (name, tags, expiration date).
   * Does not modify the actual file content in storage.
   *
   * @param id - The database ID (UUID) of the file to update
   * @param data - Partial file data to update
   * @param data.name - New file name
   * @param data.tags - New tags array
   * @param data.expirationDate - New expiration date
   * @returns The updated file entity
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async updateFile(
    id: string,
    data: {
      name?: string;
      tags?: string[];
      expirationDate?: DateTime | string;
    },
  ): Promise<FileEntity> {
    const file = await this.getFileById(id);

    const updateData: Partial<FileEntity> = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.tags !== undefined) {
      updateData.tags = data.tags;
    }

    if (data.expirationDate !== undefined) {
      updateData.expirationDate = this.dateTimeProvider
        .of(data.expirationDate)
        .toISOString();
    }

    return await this.fileRepository.updateById(file.id, updateData);
  }

  /**
   * Deletes a file from both storage and database.
   * Handles cases where file is already deleted from storage gracefully.
   * Always ensures database record is removed even if storage deletion fails.
   *
   * @param id - The database ID (UUID) of the file to delete
   * @returns Success response with the deleted file ID
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async deleteFile(id: string): Promise<Ok> {
    const file = await this.getFileById(id);
    const storage = this.storage(file.bucket);

    // Always delete the database record
    await this.fileRepository.deleteById(file.id);

    try {
      await storage.provider.delete(storage.name, file.blobId);
    } catch (e) {
      if (e instanceof FileNotFoundError) {
        // Blob is already gone, this is okay
        this.log.debug(
          `File ${file.blobId} not found in storage ${storage.name}, cleaning up database record`,
        );
      } else {
        // Other errors (permission, network, etc.) - log but continue to clean up database
        this.log.warn(
          `Failed to delete file ${file.blobId} from storage ${storage.name}`,
          e,
        );
      }
    }

    return { ok: true, id: String(file.id) };
  }

  /**
   * Delete many files in one round-trip per bucket. The database rows are
   * removed in a single `deleteMany`, and each affected bucket gets a single
   * `bucket.deleteMany` call (R2/S3 batch where supported).
   */
  public async deleteFiles(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const files = await this.fileRepository.findMany({
      where: { id: { inArray: ids } },
      columns: ["id", "bucket", "blobId"],
    });
    if (files.length === 0) return [];

    const dbDeleted = await this.fileRepository.deleteMany({
      id: { inArray: files.map((f) => f.id) },
    });

    const blobsByBucket = new Map<string, string[]>();
    for (const f of files) {
      const list = blobsByBucket.get(f.bucket) ?? [];
      list.push(f.blobId);
      blobsByBucket.set(f.bucket, list);
    }

    for (const [storageName, blobIds] of blobsByBucket) {
      try {
        const storage = this.storage(storageName);
        await storage.provider.deleteMany(storage.name, blobIds);
      } catch (e) {
        // DB rows already gone — log and continue. Orphaned blobs are
        // recoverable; orphaned DB rows would be worse.
        this.log.warn(
          `Failed to bulk-delete ${blobIds.length} files from storage ${storageName}`,
          e,
        );
      }
    }

    return dbDeleted.map(String);
  }

  /**
   * Retrieves a file entity by its ID.
   * If already an entity object, returns it as-is (convenience method).
   *
   * @param id - Either a UUID string or an existing FileEntity object
   * @returns The file entity
   * @throws {NotFoundError} If the file doesn't exist in the database
   */
  public async getFileById(id: string | FileEntity): Promise<FileEntity> {
    if (typeof id === "object") {
      return id;
    }

    return await this.fileRepository.getById(id);
  }

  /**
   * Gets storage statistics including total size, file count, and breakdowns by bucket and MIME type.
   *
   * Aggregated in SQL (`SUM`/`COUNT` + `GROUP BY`) rather than by loading
   * every row into memory — the table can hold millions of files, and this
   * endpoint must stay O(groups), not O(rows). Totals are derived from the
   * per-bucket groups (every row has exactly one bucket), so no extra query
   * is needed.
   *
   * @returns Storage statistics with aggregated data
   */
  public async getStorageStats(): Promise<StorageStats> {
    const [byBucketRows, byMimeTypeRows] = await Promise.all([
      this.fileRepository.aggregate({
        select: { bucket: true, size: { sum: true, count: true } },
        groupBy: ["bucket"],
      }),
      this.fileRepository.aggregate({
        select: { mimeType: true, size: { count: true } },
        groupBy: ["mimeType"],
      }),
    ]);

    const byBucket = byBucketRows.map((row) => ({
      bucket: row.bucket,
      totalSize: row.size.sum,
      fileCount: row.size.count,
    }));

    const byMimeType = byMimeTypeRows.map((row) => ({
      mimeType: row.mimeType,
      fileCount: row.size.count,
    }));

    return {
      totalSize: byBucket.reduce((sum, b) => sum + b.totalSize, 0),
      totalFiles: byBucket.reduce((sum, b) => sum + b.fileCount, 0),
      byBucket,
      byMimeType,
    };
  }

  /**
   * Converts a file entity to a file resource (API response format).
   * Currently a pass-through, but allows for future transformation logic.
   *
   * @param entity - The file entity to convert
   * @returns The file resource for API responses
   */
  public entityToResource(entity: FileEntity): FileResource {
    return entity;
  }
}
