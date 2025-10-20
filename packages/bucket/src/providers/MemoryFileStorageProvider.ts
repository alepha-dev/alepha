import { randomUUID } from "node:crypto";
import type { FileLike } from "@alepha/core";
import { createFile } from "@alepha/file";
import { FileNotFoundError } from "../errors/FileNotFoundError.ts";
import type { FileStorageProvider } from "./FileStorageProvider.ts";

export class MemoryFileStorageProvider implements FileStorageProvider {
  public readonly files: Record<string, FileLike> = {};

  public async upload(
    bucketName: string,
    file: FileLike,
    fileId?: string,
  ): Promise<string> {
    fileId ??= this.createId();

    this.files[`${bucketName}/${fileId}`] = createFile(file.stream(), {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    return fileId;
  }

  public async download(bucketName: string, fileId: string): Promise<FileLike> {
    const fileKey = `${bucketName}/${fileId}`;
    const file = this.files[fileKey];

    if (!file) {
      throw new FileNotFoundError(`File with ID ${fileId} not found.`);
    }

    return file;
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

  protected createId(): string {
    return randomUUID();
  }
}
