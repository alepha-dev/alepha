import { $inject, Alepha, type FileLike } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { currentTenantAtom } from "alepha/security";
import { FileDetector, FileSystemProvider } from "alepha/system";

import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

interface StoredFile {
  buffer: Buffer;
  name: string;
  type: string;
  size: number;
}

/**
 * In-memory blob storage, bound automatically under test. The `files` map is
 * public so specs can assert on what was stored without round-tripping.
 */
export class MemoryFileStorageProvider implements FileStorageProvider {
  public readonly files: Record<string, StoredFile> = {};
  protected readonly alepha = $inject(Alepha);
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);
  protected readonly crypto = $inject(CryptoProvider);

  public async upload(
    bucketName: string,
    file: FileLike,
    fileId?: string,
  ): Promise<string> {
    fileId ??= this.createId();

    // Consume the stream and store as buffer so downloads are repeatable
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.stream() as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    this.files[this.key(bucketName, fileId)] = {
      buffer,
      name: file.name,
      type: file.type,
      size: file.size,
    };

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const fileKey = this.key(bucketName, fileId);
    const stored = this.files[fileKey];

    if (!stored) {
      throw new FileNotFoundError(`File with ID ${fileId} not found.`);
    }

    // Create a fresh FileLike with a new stream from the stored buffer
    return this.fileSystem.createFile({
      stream: new Blob([new Uint8Array(stored.buffer)]).stream(),
      name: stored.name,
      type: stored.type,
      size: stored.size,
    });
  }

  public async exists(bucketName: string, fileId: string): Promise<boolean> {
    return this.key(bucketName, fileId) in this.files;
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    const fileKey = this.key(bucketName, fileId);
    if (!(fileKey in this.files)) {
      throw new FileNotFoundError(`File with ID ${fileId} not found.`);
    }

    delete this.files[fileKey];
  }

  public async deleteMany(
    bucketName: string,
    fileIds: string[],
  ): Promise<void> {
    for (const id of fileIds) {
      delete this.files[this.key(bucketName, id)];
    }
  }

  public async list(bucketName: string): Promise<string[]> {
    const prefix = this.key(bucketName, "");
    return Object.keys(this.files)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  /**
   * In-memory key, tenant-scoped when a tenant is active (`currentTenantAtom`),
   * mirroring the R2/Local/S3 layout: `{tenantId}/{bucket}/{fileId}`.
   */
  protected key(bucket: string, fileId = ""): string {
    const tenantId = this.alepha.store.get(currentTenantAtom)?.id;
    return tenantId ? `${tenantId}/${bucket}/${fileId}` : `${bucket}/${fileId}`;
  }

  protected createId(): string {
    return this.crypto.randomUUID();
  }
}
