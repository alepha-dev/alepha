import { randomUUID } from "node:crypto";
import { Alepha, type Service } from "alepha";
import {
  $bucket,
  FileStorageProvider,
  LocalFileStorageProvider,
  MemoryFileStorageProvider,
} from "alepha/bucket";
import { FileSystemProvider } from "alepha/file";
import { describe, expect, it } from "vitest";
import { AlephaApiFiles } from "../../src/api-files";
import { FileController } from "../../src/api-files/controllers/FileController.ts";

const testFileServiceOperations = async (
  provider: Service<FileStorageProvider>,
) => {
  const alepha = Alepha.create()
    .with({
      provide: FileStorageProvider,
      use: provider,
    })
    .with(AlephaApiFiles);

  class Assets {
    images = $bucket({
      name: randomUUID(),
      ttl: 1000,
    });
  }

  const assets = alepha.inject(Assets);
  const ctrl = alepha.inject(FileController);
  const fs = alepha.inject(FileSystemProvider);

  await alepha.start();

  const createFile = (
    textOrOpts: string | { text: string; name?: string; type?: string },
    opts?: { name?: string; type?: string },
  ) => {
    if (typeof textOrOpts === "string") {
      return fs.createFile({ text: textOrOpts, ...(opts || {}) });
    }
    return fs.createFile(textOrOpts);
  };

  await assets.images.upload(
    createFile("Hello World 1", {
      type: "text/plain",
      name: "hello.txt",
    }),
  );

  const files = await ctrl.findFiles.run({});

  expect(files.content[0].bucket).toBe(assets.images.name);

  await ctrl.uploadFile.run({
    query: {
      bucket: assets.images.name,
    },
    body: {
      file: createFile("Hello World 2"),
    },
  });

  await ctrl.uploadFile.fetch({
    query: {
      bucket: assets.images.name,
    },
    body: {
      file: createFile("Hello World 3"),
    },
  });

  await ctrl.uploadFile.fetch({
    query: {
      bucket: assets.images.name,
    },
    body: {
      file: createFile("Hello World 4"),
    },
  });

  const files2 = await ctrl.findFiles.run({});

  expect(files2.content.length).toBe(4);

  const response = await ctrl.streamFile.run({
    params: { id: files2.content[1].id },
  });

  expect(await response.text()).toBe("Hello World 3");

  const response2 = await ctrl.streamFile.fetch({
    params: { id: files2.content[0].id },
  });

  expect(await response2.data.text()).toBe("Hello World 4");
};

describe("FileService", () => {
  it("should handle basic file operations with memory storage", async () => {
    await testFileServiceOperations(MemoryFileStorageProvider);
  });

  it("should handle basic file operations with local storage", async () => {
    await testFileServiceOperations(LocalFileStorageProvider);
  });
});
