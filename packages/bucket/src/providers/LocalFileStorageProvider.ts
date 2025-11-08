import { randomUUID } from "node:crypto";
import type * as fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  $atom,
  $hook,
  $inject,
  $use,
  Alepha,
  AlephaError,
  type FileLike,
  type Static,
  t,
} from "@alepha/core";
import { FileSystem } from "@alepha/file";
import { $logger } from "@alepha/logger";
import { $bucket } from "../descriptors/$bucket.ts";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import { FileMetadataService } from "../services/FileMetadataService.ts";
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
    storagePath: "node_modules/.buckets",
  },
});

export type LocalFileStorageProviderOptions = Static<
  typeof localFileStorageOptions.schema
>;

declare module "@alepha/core" {
  interface State {
    [localFileStorageOptions.key]: LocalFileStorageProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LocalFileStorageProvider implements FileStorageProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly metadataService = $inject(FileMetadataService);
  protected readonly fileSystem = $inject(FileSystem);
  protected readonly options = $use(localFileStorageOptions);

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
        this.alepha.state.set(localFileStorageOptions, {
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

      for (const bucket of this.alepha.descriptors($bucket)) {
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
    fileId ??= this.createId();

    const { header, metadata } = this.metadataService.encodeMetadata(file);

    return new Promise((resolve, reject) => {
      const path = this.path(bucketName, fileId!);
      this.log.trace(`Uploading file to ${path}`);
      const writeStream = createWriteStream(path);
      writeStream.on("finish", () => resolve(fileId));
      writeStream.on("error", reject);

      writeStream.write(header);
      writeStream.write(metadata);
      Readable.from(file.stream()).pipe(writeStream);
    });
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const filePath = this.path(bucketName, fileId);

    let fileHandle: FileHandle | undefined;
    try {
      fileHandle = await open(filePath, "r");

      const { metadata, contentStart } =
        await this.metadataService.decodeMetadata(fileHandle);

      // get the total file size
      const stats = await fileHandle.stat();
      const contentSize = stats.size - contentStart;

      // create a FileLike object that streams only the content part!
      return this.fileSystem.createFile({
        stream: createReadStream(filePath, { start: contentStart }),
        name: metadata.name,
        type: metadata.type,
        size: contentSize,
      });
    } catch (error) {
      if (this.isErrorNoEntry(error)) {
        throw new FileNotFoundError(`File with ID ${fileId} not found.`);
      }
      throw new AlephaError("Invalid file operation", { cause: error });
    } finally {
      await fileHandle?.close();
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

  protected stat(bucket: string, fileId: string): Promise<fs.Stats> {
    return stat(this.path(bucket, fileId));
  }

  protected createId(): string {
    return randomUUID();
  }

  protected path(bucket: string, fileId = ""): string {
    return join(this.storagePath, bucket, fileId);
  }

  protected isErrorNoEntry(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
