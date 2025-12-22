import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
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
import { FileDetector, FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";

const envSchema = t.object({
  /**
   * Custom S3 endpoint URL for S3-compatible services.
   *
   * Examples:
   * - Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com
   * - MinIO: http://localhost:9000
   * - DigitalOcean Spaces: https://<region>.digitaloceanspaces.com
   *
   * Leave empty for AWS S3.
   */
  S3_ENDPOINT: t.optional(t.string()),

  /**
   * AWS region or "auto" for R2.
   *
   * @default "us-east-1"
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

  /**
   * Force path-style URLs (required for MinIO and some S3-compatible services).
   * Set to "true" to enable.
   */
  S3_FORCE_PATH_STYLE: t.optional(t.string()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * S3-compatible storage implementation of File Storage Provider.
 *
 * Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and other S3-compatible services.
 */
export class S3FileStorageProvider implements FileStorageProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly buckets: Set<string> = new Set();

  protected readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: this.env.S3_ENDPOINT || undefined,
      region: this.env.S3_REGION || "us-east-1",
      credentials: {
        accessKeyId: this.env.S3_ACCESS_KEY_ID,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      for (const bucket of this.alepha.primitives($bucket)) {
        if (bucket.provider !== this) {
          continue;
        }

        const bucketName = this.convertName(bucket.name);

        this.log.debug(`Preparing S3 bucket '${bucketName}'...`);

        // Check if bucket exists, create if not
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: bucketName }));
        } catch (error) {
          if (this.isNotFoundError(error)) {
            this.log.debug(`Creating S3 bucket '${bucketName}'...`);
            await this.client.send(
              new CreateBucketCommand({ Bucket: bucketName }),
            );
          } else {
            throw error;
          }
        }

        this.buckets.add(bucketName);
        this.log.info(`S3 bucket '${bucket.name}' OK`);
      }
    },
  });

  /**
   * Convert bucket name to S3-compatible format.
   * S3 bucket names must be lowercase, 3-63 characters, no underscores.
   */
  public convertName(name: string): string {
    return name.replaceAll("/", "-").replaceAll("_", "-").toLowerCase();
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

    const bucket = this.convertName(bucketName);

    try {
      const body = Buffer.from(await file.arrayBuffer());

      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileId,
          Body: body,
          ContentType: file.type || "application/octet-stream",
          ContentLength: file.size,
          Metadata: {
            name: encodeURIComponent(file.name),
          },
        }),
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

    const bucket = this.convertName(bucketName);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: fileId,
        }),
      );

      if (!response.Body) {
        throw new FileNotFoundError("File not found - empty response body");
      }

      // Convert the stream to a buffer
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const mimeType =
        response.ContentType || this.fileDetector.getContentType(fileId);

      const name = response.Metadata?.name
        ? decodeURIComponent(response.Metadata.name)
        : fileId;

      return this.fileSystem.createFile({
        buffer,
        name,
        type: mimeType,
        size: response.ContentLength,
      });
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new FileNotFoundError(
          `File '${fileId}' not found in bucket '${bucketName}'`,
        );
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

    const bucket = this.convertName(bucketName);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: fileId,
        }),
      );
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    this.log.trace(`Deleting file '${fileId}' from bucket '${bucketName}'...`);

    const bucket = this.convertName(bucketName);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: fileId,
        }),
      );
    } catch (error) {
      this.log.error(`Failed to delete file: ${error}`);
      if (error instanceof Error) {
        throw new FileNotFoundError("Error deleting file", { cause: error });
      }
      throw error;
    }
  }

  protected isNotFoundError(error: unknown): boolean {
    if (error instanceof Error) {
      const name = error.name;
      // Check error name for S3 not found errors
      if (
        name === "NotFound" ||
        name === "NoSuchKey" ||
        name === "NoSuchBucket"
      ) {
        return true;
      }
      // Check HTTP status code for 404
      const metadata = (error as S3ServiceException).$metadata;
      if (metadata?.httpStatusCode === 404) {
        return true;
      }
    }
    return false;
  }
}
