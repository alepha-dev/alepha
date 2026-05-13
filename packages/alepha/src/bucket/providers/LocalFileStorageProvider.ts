import type * as fs from "node:fs";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  $atom,
  $hook,
  $inject,
  $state,
  Alepha,
  AlephaError,
  type FileLike,
  type Static,
  t,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { FileDetector, FileSystemProvider } from "alepha/system";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import { $bucket } from "../primitives/$bucket.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Local file storage configuration atom
 */
export const localFileStorageOptions = $atom({
  name: "alepha.bucket.local.options",
  schema: t.object({
    storagePath: t.string({
      description: "Directory path where files will be stored",
    }),
  }),
  default: {
    storagePath: "node_modules/.alepha/buckets",
  },
});

export type LocalFileStorageProviderOptions = Static<
  typeof localFileStorageOptions.schema
>;

declare module "alepha" {
  interface State {
    [localFileStorageOptions.key]: LocalFileStorageProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LocalFileStorageProvider implements FileStorageProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly fileSystemProvider = $inject(FileSystemProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly options = $state(localFileStorageOptions);

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
      try {
        await mkdir(this.storagePath, { recursive: true });
      } catch {}

      for (const bucket of this.alepha.primitives($bucket)) {
        if (bucket.provider !== this) {
          continue;
        }

        await mkdir(join(this.storagePath, bucket.name), {
          recursive: true,
        });

        this.log.debug(`Bucket '${bucket.name}' at ${this.storagePath} OK`);
      }
    },
  });

  public async upload(
    bucketName: string,
    file: FileLike,
    fileId?: string,
  ): Promise<string> {
    fileId ??= this.createId(file.type);

    this.log.trace(`Uploading file to ${bucketName}`);

    await this.fileSystemProvider.writeFile(
      this.path(bucketName, fileId),
      file,
    );

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const filePath = this.path(bucketName, fileId);

    try {
      const stats = await stat(filePath);
      const mimeType = this.fileDetector.getContentType(fileId);

      return this.fileSystemProvider.createFile({
        stream: createReadStream(filePath),
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
    try {
      await stat(this.path(bucketName, fileId));
      return true;
    } catch (error) {
      if (this.isErrorNoEntry(error)) {
        return false;
      }
      throw new AlephaError("Error checking file existence", { cause: error });
    }
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    try {
      return await unlink(this.path(bucketName, fileId));
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
        unlink(this.path(bucketName, id)).catch((error) => {
          if (this.isErrorNoEntry(error)) return;
          throw new AlephaError("Error deleting file", { cause: error });
        }),
      ),
    );
  }

  protected stat(bucket: string, fileId: string): Promise<fs.Stats> {
    return stat(this.path(bucket, fileId));
  }

  protected createId(mimeType: string): string {
    const ext = this.fileDetector.getExtensionFromMimeType(mimeType);
    return `${this.crypto.randomUUID()}.${ext}`;
  }

  protected path(bucket: string, fileId = ""): string {
    return join(this.storagePath, bucket, fileId);
  }

  protected isErrorNoEntry(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
