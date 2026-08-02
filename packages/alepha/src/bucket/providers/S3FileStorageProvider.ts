import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import {
  $env,
  $inject,
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
import { S3mini } from "s3mini";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

const envSchema = z.object({
  /**
   * S3 endpoint URL. The bucket name is appended (path-style) per request.
   *
   * Examples:
   * - AWS S3: `https://s3.us-east-1.amazonaws.com`
   * - Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
   * - MinIO: `http://localhost:9000`
   * - DigitalOcean Spaces: `https://<region>.digitaloceanspaces.com`
   */
  S3_ENDPOINT: z.string(),

  /**
   * The one S3 bucket that holds every container.
   *
   * Containers are key prefixes inside it, not separate buckets.
   */
  S3_BUCKET_NAME: z.string(),

  /**
   * AWS region or "auto" for R2.
   *
   * @default "auto"
   */
  S3_REGION: z.string().optional(),

  /**
   * Access key ID for S3 authentication.
   */
  S3_ACCESS_KEY_ID: z.string(),

  /**
   * Secret access key for S3 authentication.
   */
  S3_SECRET_ACCESS_KEY: z.string(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

/**
 * S3-compatible file storage provider for Node.js.
 *
 * Backed by `s3mini` (zero-dep, ~20 KB). Works with AWS S3, Cloudflare R2,
 * MinIO, DigitalOcean Spaces, Backblaze B2, and any other S3-compatible service.
 *
 * Uses path-style addressing (`<endpoint>/<S3_BUCKET_NAME>`), and keys every
 * object as `{APP_NAME}/{tenantId}/{container}/{fileId}` — the same scheme as
 * {@link R2FileStorageProvider}.
 *
 * **Required environment variables:**
 * - `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
 *
 * **Optional:**
 * - `S3_REGION` (default `auto`), `APP_NAME` (prefix, for multi-app buckets)
 *
 * Earlier versions created **one S3 bucket per container** and provisioned
 * them at boot. That capped container count at the account's bucket limit and
 * created infrastructure implicitly. The bucket is now yours to create; the
 * provider only writes keys into it.
 */
export class S3FileStorageProvider implements FileStorageProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly crypto = $inject(CryptoProvider);
  protected client?: S3mini;

  /**
   * Optional key prefix from `APP_NAME`, so several apps can share one bucket.
   */
  public get prefix(): string | undefined {
    return this.alepha.env.APP_NAME;
  }

  protected getClient(): S3mini {
    if (!this.client) {
      const endpoint = this.env.S3_ENDPOINT.replace(/\/+$/, "");
      this.client = new S3mini({
        accessKeyId: this.env.S3_ACCESS_KEY_ID,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        region: this.env.S3_REGION || "auto",
        endpoint: `${endpoint}/${this.env.S3_BUCKET_NAME}`,
      });
    }
    return this.client;
  }

  /**
   * Object key: `{APP_NAME}/{tenantId}/{container}/{fileId}`, with the
   * optional segments omitted when absent. Mirrors R2 exactly so a container
   * means the same thing on every backend.
   */
  protected key(container: string, fileId: string): string {
    const parts = [container, fileId];
    const tenantId = this.alepha.store.get(currentTenantAtom)?.id;
    if (tenantId) {
      parts.unshift(tenantId);
    }
    if (this.prefix) {
      parts.unshift(this.prefix);
    }
    return parts.join("/");
  }

  /**
   * Everything under one container, as a key prefix ending in `/`.
   */
  protected containerPrefix(container: string): string {
    return `${this.key(container, "")}`;
  }

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

    const client = this.getClient();

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await client.putObject(
        this.key(bucketName, fileId),
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

    const client = this.getClient();
    const response = await client.getObjectResponse(
      this.key(bucketName, fileId),
    );

    if (!response) {
      throw new FileNotFoundError(
        `File '${fileId}' not found in bucket '${bucketName}'`,
      );
    }

    const mimeType =
      response.headers.get("content-type") ||
      this.fileDetector.getContentType(fileId);

    const metaName = response.headers.get("x-amz-meta-name");
    const name = metaName ? decodeURIComponent(metaName) : fileId;

    const contentLength = response.headers.get("content-length");
    const size = contentLength ? Number.parseInt(contentLength, 10) : 0;

    // Stream the body straight through instead of buffering the whole object
    // into memory. `response.body` is null only for a zero-byte object.
    if (!response.body) {
      return this.fileSystem.createFile({
        buffer: Buffer.alloc(0),
        name,
        type: mimeType,
      });
    }

    return this.fileSystem.createFile({
      stream: Readable.fromWeb(response.body as unknown as NodeWebStream),
      name,
      type: mimeType,
      size,
    });
  }

  public async exists(bucketName: string, fileId: string): Promise<boolean> {
    this.log.trace(
      `Checking existence of file '${fileId}' in bucket '${bucketName}'...`,
    );

    const client = this.getClient();
    const result = await client.objectExists(this.key(bucketName, fileId));
    return result === true;
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);

    const client = this.getClient();

    // S3 DELETE is idempotent (204 either way) — check existence explicitly
    // so `delete()` behaves like Memory/Local/R2 and throws on a missing id
    // instead of silently succeeding.
    if (!(await this.exists(bucketName, fileId))) {
      throw new FileNotFoundError(
        `File '${fileId}' not found in bucket '${bucketName}'`,
      );
    }

    try {
      await client.deleteObject(this.key(bucketName, fileId));
    } catch (error) {
      this.log.error(`Failed to delete file: ${error}`);
      if (error instanceof Error) {
        throw new FileNotFoundError("Error deleting file", { cause: error });
      }
      throw error;
    }
  }

  public async list(bucketName: string): Promise<string[]> {
    this.log.trace(`Listing files in bucket '${bucketName}'...`);
    const client = this.getClient();
    // Scope to this container. Every container now shares one S3 bucket, so
    // listing without the prefix would return every other container's keys.
    const prefix = this.containerPrefix(bucketName);
    // Flat, single-page listing (~1000 keys). Not a search API.
    const objects = await client.listObjects(undefined, prefix);
    if (!objects) return [];
    return objects.map((object) =>
      object.Key.startsWith(prefix)
        ? object.Key.slice(prefix.length)
        : object.Key,
    );
  }

  public async deleteMany(
    bucketName: string,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    this.log.trace(
      `Deleting ${fileIds.length} files from bucket '${bucketName}'...`,
    );
    const client = this.getClient();
    // S3 DeleteObjects caps at 1000 keys per request.
    for (let i = 0; i < fileIds.length; i += 1000) {
      const keys = fileIds
        .slice(i, i + 1000)
        .map((id) => this.key(bucketName, id));
      try {
        // bun:s3 client exposes a per-key deleteObject; some SDKs also expose
        // deleteObjects(keys: string[]). Prefer batch when available.
        const batch = (
          client as unknown as {
            deleteObjects?: (keys: string[]) => Promise<unknown>;
          }
        ).deleteObjects;
        if (typeof batch === "function") {
          await batch.call(client, keys);
        } else {
          await Promise.all(keys.map((key) => client.deleteObject(key)));
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
