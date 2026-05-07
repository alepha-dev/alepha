import { randomUUID } from "node:crypto";
import { $inject, type FileLike } from "alepha";
import { FileDetector, FileSystemProvider } from "alepha/system";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

interface StoredFile {
  buffer: Buffer;
  name: string;
  type: string;
  size: number;
}

export class MemoryFileStorageProvider implements FileStorageProvider {
  public readonly files: Record<string, StoredFile> = {};
  protected readonly fileSystem = $inject(FileSystemProvider);
  protected readonly fileDetector = $inject(FileDetector);

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

    this.files[`${bucketName}/${fileId}`] = {
      buffer,
      name: file.name,
      type: file.type,
      size: file.size,
    };

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const fileKey = `${bucketName}/${fileId}`;
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
    return `${bucketName}/${fileId}` in this.files;
  }

  public async delete(bucketName: string, fileId: string): Promise<void> {
    const fileKey = `${bucketName}/${fileId}`;
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
      delete this.files[`${bucketName}/${id}`];
    }
  }

  protected createId(): string {
    return randomUUID();
  }
}
