import { randomUUID } from "node:crypto";

import { Alepha, type Service } from "alepha";
import {
  FileStorageProvider,
  InvalidFileError,
  LocalFileStorageProvider,
  MemoryFileStorageProvider,
} from "alepha/bucket";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { NotFoundError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { $storage, AlephaApiFiles } from "../index.ts";

class A {
  images = $storage({
    name: randomUUID(),
  });
}

const testStorageOperations = async (
  provider: Service<FileStorageProvider>,
) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
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
      return fs.createFile({ text: textOrOpts, ...opts });
    }
    if (Buffer.isBuffer(textOrOpts)) {
      return fs.createFile({ buffer: textOrOpts, ...opts });
    }
    return fs.createFile(textOrOpts);
  };

  const blob = Buffer.from("Hello, World!");

  // `upload` returns the `files` row, not a bare blob id — `.id` is what
  // callers persist and what `GET /api/files/:id` accepts.
  const stored = await assets.images.upload(
    createFile(blob, {
      name: "hello.txt",
      type: "text/plain",
    }),
  );

  expect(stored.name).toEqual("hello.txt");
  expect(stored.mimeType).toEqual("text/plain");
  expect(stored.bucket).toEqual(assets.images.name);
  expect(stored.size).toEqual(blob.length);
  expect(stored.checksum).toBeTypeOf("string");

  const fileId = stored.id;

  expect(await assets.images.exists(fileId)).toBe(true);

  const stream = await assets.images.download(fileId);
  expect(stream.type).toEqual("text/plain");
  expect(await stream.arrayBuffer()).toEqual(blob.buffer);

  const file = await assets.images.download(fileId);

  expect(await file.text()).toEqual(blob.toString("utf-8"));

  // The listing is a real DB query, not a capped provider `ls`.
  const page = await assets.images.list();
  expect(page.page.totalElements).toBe(1);
  expect(page.content[0].id).toBe(fileId);

  await assets.images.delete(fileId);

  expect(await assets.images.exists(fileId)).toBe(false);
  expect((await assets.images.list()).page.totalElements).toBe(0);

  await expect(() => assets.images.download(fileId)).rejects.toThrow();
};

describe("$storage", () => {
  it("should handle basic storage operations with memory provider", async () => {
    await testStorageOperations(MemoryFileStorageProvider);
  });

  it("should handle basic storage operations with local provider", async () => {
    await testStorageOperations(LocalFileStorageProvider);
  });

  it("rejects a file whose MIME type is not allowed", async ({ expect }) => {
    class B {
      images = $storage({ name: randomUUID(), mimeTypes: ["image/png"] });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: FileStorageProvider, use: MemoryFileStorageProvider })
      .with(AlephaApiFiles);

    const app = alepha.inject(B);
    const fs = alepha.inject(FileSystemProvider);
    await alepha.start();

    const error = await app.images
      .upload(
        fs.createFile({ text: "nope", name: "a.txt", type: "text/plain" }),
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(InvalidFileError);
    // The request itself is malformed — this file may never be accepted here,
    // no matter its size.
    expect(error.status).toBe(400);
  });

  it("rejects a file larger than maxSize", async ({ expect }) => {
    class C {
      // 1 MB cap
      tiny = $storage({ name: randomUUID(), maxSize: 1 });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: FileStorageProvider, use: MemoryFileStorageProvider })
      .with(AlephaApiFiles);

    const app = alepha.inject(C);
    const fs = alepha.inject(FileSystemProvider);
    await alepha.start();

    const error = await app.tiny
      .upload(
        fs.createFile({
          buffer: Buffer.alloc(2 * 1024 * 1024),
          name: "big.bin",
        }),
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(InvalidFileError);
    // 413, the same refusal the transport layer already answers for the same
    // condition. It used to be 400 here and 413 one layer up, so which status a
    // caller saw depended on which guard happened to notice first.
    expect(error.status).toBe(413);
  });

  /**
   * A storage handle is a capability, not a differently-spelled global
   * accessor. `get`, `download`, `delete` and `deleteMany` used to take any
   * id at all, so one handle could read and destroy another storage's files -
   * which is why Lore had to write its own ownership filter.
   */
  describe("storage boundary", () => {
    class TwoStorages {
      images = $storage({ name: randomUUID() });
      documents = $storage({ name: randomUUID() });
    }

    const boot = async () => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with({ provide: FileStorageProvider, use: MemoryFileStorageProvider })
        .with(AlephaApiFiles);
      const app = alepha.inject(TwoStorages);
      const fs = alepha.inject(FileSystemProvider);
      await alepha.start();
      return { app, fs };
    };

    it("answers NotFoundError for a file belonging to another storage", async ({
      expect,
    }) => {
      const { app, fs } = await boot();
      const foreign = await app.documents.upload(
        fs.createFile({ text: "secret", name: "contract.txt" }),
      );

      // Same answer as an id that does not exist: confirming that the id is
      // real but someone else's is itself the leak.
      await expect(app.images.get(foreign.id)).rejects.toThrow(NotFoundError);
      await expect(app.images.download(foreign.id)).rejects.toThrow(
        NotFoundError,
      );
      await expect(app.images.delete(foreign.id)).rejects.toThrow(
        NotFoundError,
      );

      // And the refused delete really did not happen.
      expect(await app.documents.get(foreign.id)).toBeDefined();
    });

    it("holds an already-loaded row to the boundary too", async ({
      expect,
    }) => {
      const { app, fs } = await boot();
      const foreign = await app.documents.upload(
        fs.createFile({ text: "secret", name: "contract.txt" }),
      );

      // `download` accepts an entity as well as an id; that branch skipped
      // the lookup, and with it the boundary.
      await expect(app.images.download(foreign)).rejects.toThrow(NotFoundError);
    });

    it("ignores foreign ids in deleteMany instead of refusing the batch", async ({
      expect,
    }) => {
      const { app, fs } = await boot();
      const mine = await app.images.upload(
        fs.createFile({ text: "a", name: "a.txt" }),
      );
      const foreign = await app.documents.upload(
        fs.createFile({ text: "b", name: "b.txt" }),
      );

      const deleted = await app.images.deleteMany([mine.id, foreign.id]);

      // One foreign id in a batch of a thousand must not fail the call.
      expect(deleted).toEqual([mine.id]);
      expect(await app.images.exists(mine.id)).toBe(false);
      expect(await app.documents.exists(foreign.id)).toBe(true);
    });

    it("applies the creator filter the app asks for", async ({ expect }) => {
      const { app, fs } = await boot();
      const owner = randomUUID();
      const stored = await app.images.upload(
        fs.createFile({ text: "a", name: "a.txt" }),
        { user: { id: owner, name: "Ada", realm: "default" } as never },
      );
      expect(stored.creator).toBe(owner);

      expect((await app.images.get(stored.id, { creator: owner })).id).toBe(
        stored.id,
      );
      await expect(
        app.images.get(stored.id, { creator: randomUUID() }),
      ).rejects.toThrow(NotFoundError);
      expect(
        await app.images.deleteMany([stored.id], { creator: randomUUID() }),
      ).toEqual([]);
      expect(await app.images.exists(stored.id)).toBe(true);
    });
  });
});
