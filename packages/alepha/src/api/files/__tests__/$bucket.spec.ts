import { randomUUID } from "node:crypto";
import { Alepha, type Service } from "alepha";
import {
  $bucket,
  FileNotFoundError,
  FileStorageProvider,
  LocalFileStorageProvider,
  MemoryFileStorageProvider,
} from "alepha/bucket";
import { FileSystemProvider } from "alepha/file";
import { describe, expect, it } from "vitest";
import { AlephaApiFiles } from "../index.ts";

class A {
  images = $bucket({
    name: randomUUID(),
  });
}

const testStorageOperations = async (
  provider: Service<FileStorageProvider>,
) => {
  const alepha = Alepha.create()
    .with({
      provide: FileStorageProvider,
      use: provider,
    })
    .with(AlephaApiFiles);

  const assets = alepha.inject(A);
  const fs = alepha.inject(FileSystemProvider);

  await alepha.start();

  const createFile = (
    textOrOpts:
      | string
      | Buffer
      | { text: string; name?: string; type?: string },
    opts?: { name?: string; type?: string },
  ) => {
    if (typeof textOrOpts === "string") {
      return fs.createFile({ text: textOrOpts, ...(opts || {}) });
    }
    if (Buffer.isBuffer(textOrOpts)) {
      return fs.createFile({ buffer: textOrOpts, ...(opts || {}) });
    }
    return fs.createFile(textOrOpts);
  };

  const blob = Buffer.from("Hello, World!");

  const fileId = await assets.images.upload(
    createFile(blob, {
      name: "hello.txt",
      type: "text/plain",
    }),
  );

  expect(await assets.images.exists(fileId)).toBe(true);

  const stream = await assets.images.download(fileId);
  expect(stream.type).toEqual("text/plain");
  expect(await stream.arrayBuffer()).toEqual(blob.buffer);

  const file = await assets.images.download(fileId);

  expect(await file.text()).toEqual(blob.toString("utf-8"));

  await assets.images.delete(fileId);

  expect(await assets.images.exists(fileId)).toBe(false);

  await expect(() => assets.images.download(fileId)).rejects.toThrow(
    FileNotFoundError,
  );

  await expect(() => assets.images.delete(fileId)).rejects.toThrow(
    FileNotFoundError,
  );
};

describe("$bucket", () => {
  it("should handle basic storage operations with memory provider", async () => {
    await testStorageOperations(MemoryFileStorageProvider);
  });

  it("should handle basic storage operations with local provider", async () => {
    await testStorageOperations(LocalFileStorageProvider);
  });
});
