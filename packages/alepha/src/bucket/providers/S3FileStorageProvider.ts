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
import { MultipartChunker } from "../helpers/MultipartChunker.ts";
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
  S3_ENDPOINT: z.string().meta({ secret: false }),

  /**
   * The one S3 bucket that holds every container.
   *
   * Containers are key prefixes inside it, not separate buckets.
   */
  S3_BUCKET_NAME: z.string().meta({ secret: false }),

  /**
   * AWS region or "auto" for R2.
   *
   * @default "auto"
   */
  S3_REGION: z.string().meta({ secret: false }).optional(),

  /**
   * Access key ID for S3 authentication.
   */
  S3_ACCESS_KEY_ID: z.string(),

  /**
   * Secret access key for S3 authentication.
   */
  S3_SECRET_ACCESS_KEY: z.string(),

  /**
   * Key prefix for every object this app writes, so several apps can share one
   * bucket without seeing each other's keys.
   *
   * Takes precedence over `APP_NAME`, which is the older way to say the same
   * thing and remains the fallback so already-deployed objects do not move.
   * Prefer this one from a deployment: `APP_NAME` also namespaces cookies and
   * the `Server-Timing` header, so a host that repurposed it to lay out object
   * storage would log every user out as a side effect.
   *
   * @example
   * S3_KEY_PREFIX=apps/lore/production/blobs
   */
  S3_KEY_PREFIX: z.string().meta({ secret: false }).optional(),
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
 * object as `{prefix}/{tenantId}/{container}/{fileId}` — the same scheme as
 * {@link R2FileStorageProvider}.
 *
 * **Required environment variables:**
 * - `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
 *
 * **Optional:**
 * - `S3_REGION` (default `auto`)
 * - `S3_KEY_PREFIX` (prefix, for multi-app buckets), or `APP_NAME` as a fallback
 *
 * Earlier versions created **one S3 bucket per container** and provisioned
 * them at boot. That capped container count at the account's bucket limit and
 * created infrastructure implicitly. The bucket is now yours to create; the
 * provider only writes keys into it.
 */
export class S3FileStorageProvider implements FileStorageProvider {
  protected readonly chunker = new MultipartChunker();

  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly crypto = $inject(CryptoProvider);
  protected client?: S3mini;

  /**
   * Optional key prefix, so several apps can share one bucket.
   *
   * `S3_KEY_PREFIX` first, `APP_NAME` as the fallback: the fallback is what
   * keeps every already-deployed app's objects exactly where they are.
   */
  public get prefix(): string | undefined {
    return this.env.S3_KEY_PREFIX || this.alepha.env.APP_NAME;
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
   * Object key: `{prefix}/{tenantId}/{container}/{fileId}`, with the optional
   * segments omitted when absent. Mirrors R2 exactly so a container means the
   * same thing on every backend.
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

  /**
   * Uploads a file, streaming it when its size is not known up front.
   *
   * A `FileLike` built from a request body reports `size === 0` until it is
   * read, so asking it for an `arrayBuffer()` is asking for the whole payload
   * in RAM — which is exactly what a streamed upload exists to avoid. Known
   * sizes keep the single `PutObject`: it is one request instead of three, and
   * a small file has nothing to gain from multipart.
   */
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
    const key = this.key(bucketName, fileId);

    try {
      if (file.size > 0) {
        const buffer = new Uint8Array(await file.arrayBuffer());
        await client.putObject(
          key,
          buffer,
          file.type || "application/octet-stream",
          undefined,
          { "x-amz-meta-name": encodeURIComponent(file.name) },
          file.size,
        );
      } else {
        await this.uploadStreamed(client, key, file);
      }

      this.log.trace(`File uploaded successfully: ${fileId}`);
      return fileId;
    } catch (error) {
      this.log.error(`Failed to upload file: ${error}`);
      // An `AlephaError` came from this framework and already says what it
      // means — `InvalidFileError` carries a status, and re-dressing it as a
      // generic "Upload failed" dropped that status on the floor, so a refusal
      // the caller could have acted on arrived as an anonymous 500. It reaches
      // here at all because a streamed upload's size cap can only fire
      // mid-transfer, inside the transport call. R2 relayed it; S3 did not.
      if (error instanceof AlephaError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new AlephaError(`Upload failed: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Uploads a stream of unknown length as a multipart upload.
   *
   * The only shape S3 offers for "I do not know how big this is": a single
   * `PutObject` demands a `Content-Length` the sender does not have.
   *
   * A failure aborts the upload. Without that, every interrupted transfer would
   * leave its parts billed and invisible — S3 keeps them until someone says
   * otherwise, and nobody ever does.
   */
  protected async uploadStreamed(
    client: S3mini,
    key: string,
    file: FileLike,
  ): Promise<void> {
    // Decided by reading, not by asking: `size` is 0 for a stream and 0 for an
    // empty file alike, so the first part is taken and multipart begins only if
    // a second one follows. One `PutObject` beats three requests, and S3
    // refuses to complete an upload of a single short part anyway.
    const parts = this.chunker.parts(file)[Symbol.asyncIterator]();
    const first = await parts.next();
    const head = first.done ? new Uint8Array(0) : first.value;
    const second = await parts.next();

    if (second.done) {
      await client.putObject(
        key,
        head,
        file.type || "application/octet-stream",
        undefined,
        { "x-amz-meta-name": encodeURIComponent(file.name) },
        head.length,
      );
      return;
    }

    const uploadId = await client.getMultipartUploadId(
      key,
      file.type || "application/octet-stream",
    );

    const uploaded: Array<Awaited<ReturnType<S3mini["uploadPart"]>>> = [];

    try {
      uploaded.push(await client.uploadPart(key, uploadId, head, 1));
      uploaded.push(await client.uploadPart(key, uploadId, second.value, 2));
      let partNumber = 3;
      while (true) {
        const next = await parts.next();
        if (next.done) {
          break;
        }
        uploaded.push(
          await client.uploadPart(key, uploadId, next.value, partNumber),
        );
        partNumber++;
      }
      await client.completeMultipartUpload(key, uploadId, uploaded);
    } catch (error) {
      await client.abortMultipartUpload(key, uploadId).catch((abortError) => {
        this.log.error(
          `Failed to abort multipart upload ${uploadId}`,
          abortError,
        );
      });
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
