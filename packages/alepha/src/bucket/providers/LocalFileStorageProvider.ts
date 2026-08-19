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

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const filePath = this.path(bucketName, fileId);

    try {
      const stats = await this.fileSystemProvider.stat(filePath);
      const mimeType = this.fileDetector.getContentType(fileId);

      return this.fileSystemProvider.createFile({
        stream: await this.fileSystemProvider.readFileStream(filePath),
        name: fileId,
        type: mimeType,
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
          .catch((error) => {
            throw new AlephaError("Error deleting file", { cause: error });
          }),
      ),
    );
  }

  public async list(bucketName: string): Promise<string[]> {
    try {
      return await this.fileSystemProvider.ls(this.path(bucketName));
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
    // Per-tenant directory when a tenant is active, mirroring R2/S3 isolation.
    const tenantId = this.alepha.store.get(currentTenantAtom)?.id;
    return tenantId
      ? join(this.storagePath, tenantId, bucket, fileId)
      : join(this.storagePath, bucket, fileId);
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
