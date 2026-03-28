import { randomUUID } from "node:crypto";
import { Alepha, type Service } from "alepha";
import {
  $bucket,
  FileStorageProvider,
  LocalFileStorageProvider,
  MemoryFileStorageProvider,
} from "alepha/bucket";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import type { UserAccountToken } from "alepha/security";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { AlephaApiFiles, FileController } from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

const asAdmin = { user: adminUser };

const testFileServiceOperations = async (
  provider: Service<FileStorageProvider>,
) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
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

  const files = await ctrl.findFiles.run({}, asAdmin);

  expect(files.content[0].bucket).toBe(assets.images.name);

  await ctrl.uploadFile.run(
    {
      query: {
        bucket: assets.images.name,
      },
      body: {
        file: createFile("Hello World 2"),
      },
    },
    asAdmin,
  );

  await ctrl.uploadFile.run(
    {
      query: {
        bucket: assets.images.name,
      },
      body: {
        file: createFile("Hello World 3"),
      },
    },
    asAdmin,
  );

  await ctrl.uploadFile.run(
    {
      query: {
        bucket: assets.images.name,
      },
      body: {
        file: createFile("Hello World 4"),
      },
    },
    asAdmin,
  );

  const files2 = await ctrl.findFiles.run({}, asAdmin);

  expect(files2.content.length).toBe(4);

  const response = await ctrl.streamFile.run(
    { params: { id: files2.content[1].id } },
    asAdmin,
  );

  expect(await response.text()).toBe("Hello World 3");

  const response2 = await ctrl.streamFile.run(
    { params: { id: files2.content[0].id } },
    asAdmin,
  );

  expect(await response2.text()).toBe("Hello World 4");
};

describe("FileService", () => {
  it("should handle basic file operations with memory storage", async () => {
    await testFileServiceOperations(MemoryFileStorageProvider);
  });

  it("should handle basic file operations with local storage", async () => {
    await testFileServiceOperations(LocalFileStorageProvider);
  });
});
