import { Readable } from "node:stream";

import { Alepha } from "alepha";
import { FileTooLargeError } from "alepha/bucket";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import type { UserAccountToken } from "alepha/security";
import { FileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  $storage,
  AlephaApiFiles,
  FileController,
  FileService,
  filesOptions,
} from "../index.ts";

const MB = 1024 * 1024;

const admin: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

class Media {
  docs = $storage({ name: "docs", provider: "memory", maxSize: 100 });
  photos = $storage({ name: "photos", provider: "memory", maxSize: 100 });
}

describe("filesOptions.maxTotalSize", () => {
  const setup = async (
    options: { maxTotalSize?: number; env?: Record<string, string> } = {},
  ) => {
    const alepha = Alepha.create({ env: options.env })
      .with(AlephaOrmPostgres)
      .with(AlephaApiFiles);
    const media = alepha.inject(Media);
    const files = alepha.inject(FileService);
    const controller = alepha.inject(FileController);
    const fs = alepha.inject(FileSystemProvider);
    if (options.maxTotalSize !== undefined) {
      alepha.store.set(filesOptions, { maxTotalSize: options.maxTotalSize });
    }
    await alepha.start();

    const bytes = (size: number, name = "blob.bin") =>
      fs.createFile({
        arrayBuffer: new Uint8Array(size).buffer as ArrayBuffer,
        name,
        type: "application/octet-stream",
      });

    // No declared size, so `FileService` has to read it to find out, and
    // anything past its 10 MB buffer threshold takes the streaming path.
    const streamed = (megabytes: number) =>
      fs.createFile({
        stream: Readable.from(
          Array.from({ length: megabytes }, () => Buffer.alloc(MB)),
        ),
        name: "big.bin",
        type: "application/octet-stream",
      });

    return { alepha, media, files, controller, bytes, streamed };
  };

  it("is unlimited by default", async ({ expect }) => {
    const { alepha, media, bytes } = await setup();

    expect(alepha.store.get(filesOptions).maxTotalSize).toBe(0);
    await media.docs.upload(bytes(2 * MB));
    await media.docs.upload(bytes(2 * MB));
    expect((await media.docs.list()).page.totalElements).toBe(2);
  });

  it("refuses an upload that would take the total past the quota", async ({
    expect,
  }) => {
    const { media, bytes } = await setup({ maxTotalSize: 1 });

    await media.docs.upload(bytes(600 * 1024));

    const refusal = media.docs.upload(bytes(600 * 1024));
    await expect(refusal).rejects.toThrow(FileTooLargeError);
    await expect(refusal).rejects.toThrow(
      "Upload exceeds the total storage quota of 1 MB (0.4 MB left)",
    );
    expect((await media.docs.list()).page.totalElements).toBe(1);
  });

  it("answers 413 on the upload endpoint", async ({ expect }) => {
    const { media, controller, bytes } = await setup({ maxTotalSize: 1 });

    await media.docs.upload(bytes(600 * 1024));

    await expect(
      controller.uploadFile.run(
        { query: { bucket: "docs" }, body: { file: bytes(600 * 1024) } },
        { user: admin },
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("counts every storage together", async ({ expect }) => {
    const { media, bytes } = await setup({ maxTotalSize: 1 });

    await media.docs.upload(bytes(600 * 1024));

    await expect(media.photos.upload(bytes(600 * 1024))).rejects.toThrow(
      FileTooLargeError,
    );
  });

  it("gives the space back when a file is deleted", async ({ expect }) => {
    const { media, bytes } = await setup({ maxTotalSize: 1 });

    const first = await media.docs.upload(bytes(600 * 1024));
    await media.docs.delete(first.id);

    await media.docs.upload(bytes(600 * 1024));
    expect((await media.docs.list()).page.totalElements).toBe(1);
  });

  it("refuses a streamed upload mid-transfer once it outgrows what is left", async ({
    expect,
  }) => {
    // 11 MB is read before the stream is handed on, which fits in 12; the
    // other 3 MB are counted on the way through and the 13th is refused.
    const { media, streamed } = await setup({ maxTotalSize: 12 });

    await expect(media.docs.upload(streamed(14))).rejects.toThrow(
      "Upload exceeds the total storage quota of 12 MB",
    );
    expect((await media.docs.list()).page.totalElements).toBe(0);
  });

  it("refuses a streamed upload before it is written when what was read already does not fit", async ({
    expect,
  }) => {
    const { media, bytes, streamed } = await setup({ maxTotalSize: 12 });

    await media.docs.upload(bytes(2 * MB));

    await expect(media.docs.upload(streamed(14))).rejects.toThrow(
      "Upload exceeds the total storage quota of 12 MB (10.0 MB left)",
    );
    expect((await media.docs.list()).page.totalElements).toBe(1);
  });

  it("stores a streamed upload that fits", async ({ expect }) => {
    const { media, streamed } = await setup({ maxTotalSize: 20 });

    const stored = await media.docs.upload(streamed(14));
    expect(stored.size).toBe(14 * MB);
  });

  it("takes FILES_MAX_TOTAL_SIZE over a value set in code", async ({
    expect,
  }) => {
    const { alepha, media, bytes } = await setup({
      maxTotalSize: 100,
      env: { FILES_MAX_TOTAL_SIZE: "1" },
    });

    expect(alepha.store.get(filesOptions).maxTotalSize).toBe(1);
    await media.docs.upload(bytes(600 * 1024));
    await expect(media.docs.upload(bytes(600 * 1024))).rejects.toThrow(
      FileTooLargeError,
    );
  });
});
