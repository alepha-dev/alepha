import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  $atom,
  $hook,
  $inject,
  $store,
  Alepha,
  AlephaError,
  type FileLike,
  type Infer,
  z,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { currentTenantAtom } from "alepha/security";
import { FileDetector, FileSystemProvider } from "alepha/system";

import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Local file storage configuration atom
 */
export const localFileStorageOptions = $atom({
  name: "alepha.bucket.local.options",
  schema: z.object({
    storagePath: z
      .string()
      .describe("Directory path where files will be stored"),
  }),
  default: {
    storagePath: "node_modules/.alepha/buckets",
  },
  serverOnly: true,
});

export type LocalFileStorageProviderOptions = Infer<
  typeof localFileStorageOptions.schema
>;

declare module "alepha" {
  interface State {
    [localFileStorageOptions.key]: LocalFileStorageProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a sidecar holds: the two fields the filesystem cannot answer for.
 *
 * Not `size` - `stat` already knows it, and a second copy could drift. Not
 * `lastModified` either: `FileSystemProvider.createFile` has no option for it,
 * so nothing could read it back, and no other backend preserves it.
 */
interface BlobMetadata {
  name: string;
  type: string;
}

/**
 * Filesystem-backed blob storage - the Node default when `S3_ENDPOINT` is
 * unset. Blobs live under `STORAGE_PATH` (falling back to `DATA_DIR`), which
 * must sit outside the deployed bundle so uploads survive a redeploy.
 */
export class LocalFileStorageProvider implements FileStorageProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly fileSystemProvider = $inject(FileSystemProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly options = $store(localFileStorageOptions);

  /**
   * Suffix of the sidecar written beside every blob. Reserved as a file id.
   */
  protected readonly metaSuffix = ".meta.json";

  protected get storagePath(): string {
    return this.options.storagePath;
  }

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      if (
        this.alepha.isTest() &&
        this.storagePath === localFileStorageOptions.options.default.storagePath
      ) {
        this.alepha.store.set(localFileStorageOptions, {
          storagePath: join(tmpdir(), `alepha-test-${Date.now()}`),
        });
      }
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Only the root. Per-container directories are created lazily by
      // `upload`, which already does a recursive mkdir — pre-creating them
      // meant enumerating a primitive registry this provider no longer knows
      // (and never needed) anything about.
      try {
        await this.fileSystemProvider.mkdir(this.storagePath);
      } catch {}
    },
  });

  public async upload(
    bucketName: string,
    file: FileLike,
    fileId?: string,
  ): Promise<string> {
    fileId ??= this.createId(file.type);

    this.log.trace(`Uploading file to ${bucketName}`);

    // The per-tenant sub-directory isn't pre-created by `onStart` (which only
    // knows the un-scoped bucket name), so ensure it exists before writing.
    await this.fileSystemProvider.mkdir(this.path(bucketName));
    await this.fileSystemProvider.writeFile(
      this.path(bucketName, fileId),
      file,
    );
    await this.fileSystemProvider.writeJsonFile(
      this.metaPath(bucketName, fileId),
      {
        name: file.name,
        type: file.type,
      } satisfies BlobMetadata,
    );

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const filePath = this.path(bucketName, fileId);
    const meta = await this.readMeta(bucketName, fileId);

    try {
      const stats = await this.fileSystemProvider.stat(filePath);

      return this.fileSystemProvider.createFile({
        stream: await this.fileSystemProvider.readFileStream(filePath),
        // Falling back to the id is what every blob written before the
        // sidecar existed gets: a name that is the storage key and a type
        // sniffed from its extension.
        name: meta?.name ?? fileId,
        type: meta?.type ?? this.fileDetector.getContentType(fileId),
        // From the file on disk, never from the sidecar: it is the one field
        // the filesystem already knows authoritatively, and a stored copy
        // would be a second answer free to drift from the bytes.
        size: stats.size,
      });
    } catch (error) {
      if (this.isErrorNoEntry(error)) {
        throw new FileNotFoundError(`File with ID ${fileId} not found.`);
      }
      throw new AlephaError("Invalid file operation", { cause: error });
    }
  }

  public async exists(bucketName: string, fileId: string): Promise<boolean> {
    return this.fileSystemProvider.exists(this.path(bucketName, fileId));
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    try {
      await this.fileSystemProvider.rm(this.path(bucketName, fileId));
      await this.removeMeta(bucketName, fileId);
    } catch (error) {
      if (this.isErrorNoEntry(error)) {
        throw new FileNotFoundError(`File with ID ${fileId} not found.`);
      }
      throw new AlephaError("Error deleting file", { cause: error });
    }
  }

  public async deleteMany(
    bucketName: string,
    fileIds: string[],
  ): Promise<void> {
    await Promise.all(
      fileIds.map((id) =>
        this.fileSystemProvider
          .rm(this.path(bucketName, id), { force: true })
          .then(() => this.removeMeta(bucketName, id))
          .catch((error) => {
            throw new AlephaError("Error deleting file", { cause: error });
          }),
      ),
    );
  }

  public async list(bucketName: string): Promise<string[]> {
    try {
      const entries = await this.fileSystemProvider.ls(this.path(bucketName));
      // Sidecars are an implementation detail of this provider: the other
      // backends carry the same metadata inside the object, and `list` is
      // documented as returning file identifiers. `path` rejects the suffix
      // as an id, so nothing real can be hidden by this filter.
      return entries.filter((entry) => !entry.endsWith(this.metaSuffix));
    } catch (error) {
      if (this.isErrorNoEntry(error)) {
        return [];
      }
      throw new AlephaError("Error listing files", { cause: error });
    }
  }

  protected createId(mimeType: string): string {
    const ext = this.fileDetector.getExtensionFromMimeType(mimeType);
    return `${this.crypto.randomUUID()}.${ext}`;
  }

  protected path(bucket: string, fileId = ""): string {
    // File ids are opaque keys on S3/R2 but filesystem paths here — reject
    // separators and dot-dot so a caller-supplied id cannot escape the root.
    if (/[/\\]/.test(fileId) || fileId.includes("..")) {
      throw new AlephaError(`Invalid file id: ${fileId}`);
    }
    // Reserved, because `<id>.meta.json` is where this provider keeps the
    // name and MIME type. Refusing the id loudly beats letting an upload
    // shadow another blob's metadata, or hide itself from `list`.
    if (fileId.endsWith(this.metaSuffix)) {
      throw new AlephaError(
        `Invalid file id: ${fileId} ('${this.metaSuffix}' is reserved)`,
      );
    }
    // Per-tenant directory when a tenant is active, mirroring R2/S3 isolation.
    const tenantId = this.alepha.store.get(currentTenantAtom)?.id;
    return tenantId
      ? join(this.storagePath, tenantId, bucket, fileId)
      : join(this.storagePath, bucket, fileId);
  }

  /**
   * Path of the sidecar holding what the filesystem cannot: the name the file
   * was uploaded under, and its declared MIME type.
   */
  protected metaPath(bucket: string, fileId: string): string {
    return `${this.path(bucket, fileId)}${this.metaSuffix}`;
  }

  /**
   * The stored metadata, or `undefined` when there is none to read.
   *
   * Missing is the normal case for a blob written before sidecars existed,
   * and unreadable (truncated, hand-edited) is treated the same way: the
   * caller falls back to sniffing rather than failing a download over the
   * annotation of a file that is perfectly readable.
   */
  protected async readMeta(
    bucket: string,
    fileId: string,
  ): Promise<BlobMetadata | undefined> {
    try {
      const meta = await this.fileSystemProvider.readJsonFile<BlobMetadata>(
        this.metaPath(bucket, fileId),
      );
      return typeof meta?.name === "string" && typeof meta?.type === "string"
        ? meta
        : undefined;
    } catch {
      return undefined;
    }
  }

  protected async removeMeta(bucket: string, fileId: string): Promise<void> {
    await this.fileSystemProvider.rm(this.metaPath(bucket, fileId), {
      force: true,
    });
  }

  protected isErrorNoEntry(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    // Node errors carry a `code`; MemoryFileSystemProvider throws AlephaError
    // with the same ENOENT prefix in the message. Both mean "not there".
    return (
      ("code" in error && error.code === "ENOENT") ||
      error.message.startsWith("ENOENT")
    );
  }
}
