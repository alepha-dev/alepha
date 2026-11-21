import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { Alepha, type Service } from "alepha";
import {
  FileStorageProvider,
  LocalFileStorageProvider,
  MemoryFileStorageProvider,
} from "alepha/bucket";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { users } from "../../users/entities/users.ts";
import {
  $storage,
  AlephaApiFiles,
  FileController,
  FileService,
} from "../index.ts";

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
    .with(AlephaOrmTestPostgres)
    .with({
      provide: FileStorageProvider,
      use: provider,
    })
    .with(AlephaApiFiles);

  class Assets {
    images = $storage({
      name: randomUUID(),
      ttl: 1000,
      clientUploads: true,
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
      return fs.createFile({ text: textOrOpts, ...opts });
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

  it("removes the orphaned blob when uploadFile's metadata write fails", async () => {
    class RecordingStorage extends MemoryFileStorageProvider {
      public readonly uploaded: string[] = [];

      public override async upload(
        ...args: Parameters<MemoryFileStorageProvider["upload"]>
      ): Promise<string> {
        const blobId = await super.upload(...args);
        this.uploaded.push(blobId);
        return blobId;
      }
    }

    const alepha = Alepha.create()
      .with(AlephaOrmTestPostgres)
      .with({ provide: FileStorageProvider, use: RecordingStorage })
      .with(AlephaApiFiles);

    class Assets {
      images = $storage({ name: randomUUID() });
    }

    const assets = alepha.inject(Assets);
    const service = alepha.inject(FileService);
    const fs = alepha.inject(FileSystemProvider);

    await alepha.start();

    // A name the `name` column refuses (longer than 255), so the metadata
    // insert fails *after* the blob has already been written to storage.
    const provider = alepha.inject(RecordingStorage);

    await expect(
      service.uploadFile(
        fs.createFile({
          text: "orphan",
          name: `${"a".repeat(300)}.txt`,
          type: "text/plain",
        }),
        { bucket: assets.images.name },
      ),
    ).rejects.toThrow();

    // The blob did reach the backend: what follows is the cleanup's doing.
    expect(provider.uploaded).toHaveLength(1);

    // Assert against the BACKEND, not `images.list()`, that is DB-backed
    // now, so it would be empty whether or not the blob was cleaned up.
    expect(await provider.list(assets.images.name)).toEqual([]);
  });

  it("uploadFile reads a stream-backed file once (no empty blob, real size)", async () => {
    const alepha = Alepha.create()
      .with(AlephaOrmTestPostgres)
      .with({ provide: FileStorageProvider, use: MemoryFileStorageProvider })
      .with(AlephaApiFiles);

    class Assets {
      images = $storage({ name: randomUUID() });
    }

    const assets = alepha.inject(Assets);
    const service = alepha.inject(FileService);
    const fs = alepha.inject(FileSystemProvider);

    await alepha.start();

    const content = "streamed upload content";

    // A one-shot stream: it can only be read once. The old code drained it
    // for the checksum before bucket.upload re-read it, storing an empty blob.
    const file = fs.createFile({
      stream: Readable.toWeb(
        Readable.from(Buffer.from(content)),
      ) as unknown as ReadableStream<Uint8Array>,
      name: "stream.txt",
      type: "text/plain",
    });

    const entity = await service.uploadFile(file, {
      bucket: assets.images.name,
    });

    // Content must survive (not an empty blob), size must be the real length.
    expect(entity.size).toBe(content.length);
    expect(entity.checksum).toBe(
      createHash("sha256").update(content).digest("hex"),
    );

    const back = await service.streamFile(entity);
    expect(await back.text()).toBe(content);
  });

  it("embeds the uploader summary when a users repository is registered", async () => {
    // Registering a users repository is what flips the best-effort join on
    // (and creates the `users` table). Without it, the prior tests confirm
    // findFiles still works and simply leaves `user` undefined.
    class TestUsers {
      repo = $repository(users);
    }

    const alepha = Alepha.create()
      .with(AlephaOrmTestPostgres)
      .with({ provide: FileStorageProvider, use: MemoryFileStorageProvider })
      .with(AlephaApiFiles);

    const testUsers = alepha.inject(TestUsers);
    const ctrl = alepha.inject(FileController);
    const fs = alepha.inject(FileSystemProvider);

    await alepha.start();

    await testUsers.repo.create({
      id: adminUser.id,
      email: "uploader@example.com",
      username: "uploader",
    });

    await ctrl.uploadFile.run(
      {
        body: {
          file: fs.createFile({
            text: "joined",
            name: "joined.txt",
            type: "text/plain",
          }),
        },
      },
      asAdmin,
    );

    const files = await ctrl.findFiles.run({}, asAdmin);

    expect(files.content).toHaveLength(1);
    expect(files.content[0].creator).toBe(adminUser.id);
    expect(files.content[0].user?.email).toBe("uploader@example.com");
    expect(files.content[0].user?.username).toBe("uploader");
  });
});
