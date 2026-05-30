import { Buffer } from "node:buffer";
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
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { FileDetector, FileSystemProvider } from "alepha/system";
import { S3mini } from "s3mini";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import { $bucket } from "../primitives/$bucket.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

const envSchema = t.object({
  /**
   * S3 endpoint URL. The bucket name is appended (path-style) per request.
   *
   * Examples:
   * - AWS S3: `https://s3.us-east-1.amazonaws.com`
   * - Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
   * - MinIO: `http://localhost:9000`
   * - DigitalOcean Spaces: `https://<region>.digitaloceanspaces.com`
   */
  S3_ENDPOINT: t.string(),

  /**
   * AWS region or "auto" for R2.
   *
   * @default "auto"
   */
  S3_REGION: t.optional(t.string()),

  /**
   * Access key ID for S3 authentication.
   */
  S3_ACCESS_KEY_ID: t.string(),

  /**
   * Secret access key for S3 authentication.
   */
  S3_SECRET_ACCESS_KEY: t.string(),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * S3-compatible file storage provider for Node.js.
 *
 * Backed by `s3mini` (zero-dep, ~20 KB). Works with AWS S3, Cloudflare R2,
 * MinIO, DigitalOcean Spaces, Backblaze B2, and any other S3-compatible service.
 *
 * Uses path-style addressing (`<endpoint>/<bucket>`).
 */
export class S3FileStorageProvider implements FileStorageProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly clients: Map<string, S3mini> = new Map();

  /**
   * Convert bucket name to S3-compatible format.
   * S3 bucket names must be lowercase, 3-63 characters, no underscores.
   */
  public convertName(name: string): string {
    return name.replaceAll("/", "-").replaceAll("_", "-").toLowerCase();
  }

  protected getClient(bucketName: string): S3mini {
    const name = this.convertName(bucketName);
    let client = this.clients.get(name);
    if (!client) {
      const endpoint = this.env.S3_ENDPOINT.replace(/\/+$/, "");
      client = new S3mini({
        accessKeyId: this.env.S3_ACCESS_KEY_ID,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        region: this.env.S3_REGION || "auto",
        endpoint: `${endpoint}/${name}`,
      });
      this.clients.set(name, client);
    }
    return client;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      for (const bucket of this.alepha.primitives($bucket)) {
        if (bucket.provider !== this) {
          continue;
        }

        const name = this.convertName(bucket.name);
        const client = this.getClient(bucket.name);

        this.log.debug(`Preparing S3 bucket '${name}'...`);

        const exists = await client.bucketExists();
        if (!exists) {
          this.log.debug(`Creating S3 bucket '${name}'...`);
          const created = await client.createBucket();
          if (!created) {
            throw new AlephaError(`Failed to create S3 bucket '${name}'`);
          }
        }

        this.log.info(`S3 bucket '${bucket.name}' OK`);
      }
    },
  });

  protected createId(mimeType: string): string {
    const ext = this.fileDetector.getExtensionFromMimeType(mimeType);
    return `${this.crypto.randomUUID()}.${ext}`;
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

    const client = this.getClient(bucketName);

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await client.putObject(
        fileId,
        buffer,
        file.type || "application/octet-stream",
        undefined,
        { "x-amz-meta-name": encodeURIComponent(file.name) },
        file.size,
      );

      this.log.trace(`File uploaded successfully: ${fileId}`);
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

    const client = this.getClient(bucketName);
    const response = await client.getObjectResponse(fileId);

    if (!response) {
      throw new FileNotFoundError(
        `File '${fileId}' not found in bucket '${bucketName}'`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const mimeType =
      response.headers.get("content-type") ||
      this.fileDetector.getContentType(fileId);

    const metaName = response.headers.get("x-amz-meta-name");
    const name = metaName ? decodeURIComponent(metaName) : fileId;

    return this.fileSystem.createFile({
      buffer,
      name,
      type: mimeType,
      size: buffer.length,
    });
  }

  public async exists(bucketName: string, fileId: string): Promise<boolean> {
    this.log.trace(
      `Checking existence of file '${fileId}' in bucket '${bucketName}'...`,
    );

    const client = this.getClient(bucketName);
    const result = await client.objectExists(fileId);
    return result === true;
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);

    const client = this.getClient(bucketName);

    try {
      await client.deleteObject(fileId);
    } catch (error) {
      this.log.error(`Failed to delete file: ${error}`);
      if (error instanceof Error) {
        throw new FileNotFoundError("Error deleting file", { cause: error });
      }
      throw error;
    }
  }

  public async deleteMany(
    bucketName: string,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    this.log.trace(
      `Deleting ${fileIds.length} files from bucket '${bucketName}'...`,
    );
    const client = this.getClient(bucketName);
    // S3 DeleteObjects caps at 1000 keys per request.
    for (let i = 0; i < fileIds.length; i += 1000) {
      const chunk = fileIds.slice(i, i + 1000);
      try {
        // bun:s3 client exposes a per-key deleteObject; some SDKs also expose
        // deleteObjects(keys: string[]). Prefer batch when available.
        const batch = (
          client as unknown as {
            deleteObjects?: (keys: string[]) => Promise<unknown>;
          }
        ).deleteObjects;
        if (typeof batch === "function") {
          await batch.call(client, chunk);
        } else {
          await Promise.all(chunk.map((id) => client.deleteObject(id)));
        }
      } catch (error) {
        this.log.error(`Failed to delete files: ${error}`);
        if (error instanceof Error) {
          throw new FileNotFoundError("Error deleting files", { cause: error });
        }
        throw error;
      }
    }
  }
}
