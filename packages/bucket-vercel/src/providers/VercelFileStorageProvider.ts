import type { Readable } from "node:stream";
import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type FileLike,
  type Static,
  t,
} from "alepha";
import {
  $bucket,
  FileNotFoundError,
  type FileStorageProvider,
} from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { FileDetector, FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { VercelBlobApi } from "./VercelBlobProvider.ts";

const envSchema = t.object({
  BLOB_READ_WRITE_TOKEN: t.text({
    size: "long",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Vercel Blob Storage implementation of File Storage Provider.
 */
export class VercelFileStorageProvider implements FileStorageProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly stores: Set<string> = new Set();
  protected readonly vercelBlobApi = $inject(VercelBlobApi);

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      for (const bucket of this.alepha.descriptors($bucket)) {
        if (bucket.provider !== this) {
          continue;
        }

        const storeName = this.convertName(bucket.name);

        this.log.debug(`Prepare store '${storeName}' ...`);

        // Vercel Blob doesn't require explicit store/container creation
        // We just track the store names for reference
        this.stores.add(storeName);

        this.log.info(`Blob storage '${bucket.name}' OK`);
      }
    },
  });

  public convertName(name: string): string {
    // Convert to a valid path-like name for Vercel Blob
    return name.replaceAll("/", "-").toLowerCase();
  }

  protected createId(mimeType: string): string {
    const ext = this.fileDetector.getExtensionFromMimeType(mimeType);
    return `${crypto.randomUUID()}.${ext}`;
  }

  public async upload(
    bucketName: string,
    file: FileLike,
    fileId?: string,
  ): Promise<string> {
    fileId ??= this.createId(file.type);

    this.log.trace(
      `Uploading file '${file.name}' to bucket '${bucketName}' with id '${fileId}'...`,
    );

    const storeName = this.convertName(bucketName);
    const pathname = `${storeName}/${fileId}`;

    try {
      const contentBuffer = Buffer.from(await file.arrayBuffer());

      const result = await this.vercelBlobApi.put(
        pathname,
        contentBuffer as unknown as Readable,
        {
          access: "public",
          contentType: file.type || "application/octet-stream",
          token: this.env.BLOB_READ_WRITE_TOKEN,
          allowOverwrite: true,
        },
      );

      this.log.trace(`File uploaded successfully: ${result.url}`);
      return fileId;
    } catch (error) {
      this.log.error(`Failed to upload file: ${error}`);
      if (error instanceof Error) {
        throw new AlephaError(`Upload failed: ${error.message}`, {
          cause: error,
        });
      }

      throw error;
    }
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    this.log.trace(
      `Downloading file '${fileId}' from bucket '${bucketName}'...`,
    );

    const storeName = this.convertName(bucketName);
    const pathname = `${storeName}/${fileId}`;

    try {
      const headResult = await this.vercelBlobApi.head(pathname, {
        token: this.env.BLOB_READ_WRITE_TOKEN,
      });

      if (!headResult) {
        throw new FileNotFoundError(
          `File '${fileId}' not found in bucket '${bucketName}'`,
        );
      }

      const response = await fetch(headResult.url);

      if (!response.ok) {
        throw new FileNotFoundError(
          `Failed to fetch file: ${response.statusText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer) {
        throw new FileNotFoundError("File not found - empty response body");
      }

      const mimeType = this.fileDetector.getContentType(fileId);

      return this.fileSystem.createFile({
        buffer: Buffer.from(arrayBuffer),
        name: fileId,
        type: mimeType,
      });
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        throw error;
      }

      this.log.error(`Failed to download file: ${error}`);
      if (error instanceof Error) {
        throw new FileNotFoundError("Error downloading file", { cause: error });
      }

      throw error;
    }
  }

  public async exists(bucketName: string, fileId: string): Promise<boolean> {
    this.log.trace(
      `Checking existence of file '${fileId}' in bucket '${bucketName}'...`,
    );

    const storeName = this.convertName(bucketName);
    const pathname = `${storeName}/${fileId}`;

    try {
      const result = await this.vercelBlobApi.head(pathname, {
        token: this.env.BLOB_READ_WRITE_TOKEN,
      });
      return result !== null;
    } catch (error) {
      // Vercel Blob head() throws for non-existent files
      return false;
    }
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);

    const storeName = this.convertName(bucketName);
    const pathname = `${storeName}/${fileId}`;

    try {
      await this.vercelBlobApi.del(pathname, {
        token: this.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (error) {
      this.log.error(`Failed to delete file: ${error}`);
      if (error instanceof Error) {
        throw new FileNotFoundError("Error deleting file", { cause: error });
      }
      throw error;
    }
  }
}
