import { Alepha } from "alepha";
import { describe, test } from "vitest";
import {
  $bucket,
  AlephaBucket,
  FileStorageProvider,
  MemoryFileStorageProvider,
} from "../../src/bucket";
import { InvalidFileError } from "../../src/bucket/errors/InvalidFileError.ts";

class TestApp {
  images = $bucket({
    maxSize: 1, // MB
    mimeTypes: ["image/png", "image/jpeg"],
  });
}

const alepha = Alepha.create().with(AlephaBucket).with(TestApp);

describe("$bucket", () => {
  test("should reject mimeTypes", async ({ expect }) => {
    const app = alepha.inject(TestApp);
    const file = new File(["test content"], "test.txt", { type: "text/plain" });

    await expect(app.images.upload(file)).rejects.toThrow(InvalidFileError);
  });

  test("should reject file size", async ({ expect }) => {
    const app = alepha.inject(TestApp);
    const largeFile = new File(["a".repeat(2 * 1024 * 1024)], "large.png", {
      type: "image/png",
    });

    await expect(() => app.images.upload(largeFile)).rejects.toThrow(
      InvalidFileError,
    );
  });

  test("should upload and download files", async ({ expect }) => {
    const app = alepha.inject(TestApp);
    const file = new File(["test content"], "test.png", { type: "image/png" });

    const fileId = await app.images.upload(file);
    expect(fileId).toBeDefined();

    const downloadedFile = await app.images.download(fileId);
    expect(downloadedFile.name).toBe("test.png");
    expect(downloadedFile.type).toBe("image/png");
    expect(downloadedFile.size).toBe(file.size);
  });

  test("should call events on upload and delete", async ({ expect }) => {
    const app = alepha.inject(TestApp);
    const file = new File(["test content"], "test.png");

    let uploadEventCalled = false;
    let deleteEventCalled = false;

    alepha.events.on("bucket:file:uploaded", ({ id, file, options }) => {
      expect(id).toBeDefined();
      expect(file.name).toBe("test.png");
      expect(file.type).toBe("image/png");
      expect(file.size).toBe(file.size);
      expect(options).toEqual({
        maxSize: 2,
        mimeTypes: ["image/png", "image/jpeg"],
      });
      uploadEventCalled = true;
    });

    alepha.events.on("bucket:file:deleted", ({ id }) => {
      expect(id).toBeDefined();
      deleteEventCalled = true;
    });

    const fileId = await app.images.upload(file, { maxSize: 2 });
    expect(uploadEventCalled).toBe(true);

    await app.images.delete(fileId);
    expect(deleteEventCalled).toBe(true);
  });

  test("should use many providers", async ({ expect }) => {
    class MySecondMemoryProvider extends MemoryFileStorageProvider {}
    class AnotherApp {
      gn = $bucket({
        provider: MySecondMemoryProvider,
      });
    }

    const alepha = Alepha.create().with(AlephaBucket).with(AnotherApp);
    await alepha.start();

    const app = alepha.inject(AnotherApp);
    const file = new File(["test content"], "test.png", { type: "image/png" });
    const fileId = await app.gn.upload(file);
    await expect(
      alepha.inject(FileStorageProvider).exists(app.gn.name, fileId),
    ).resolves.toBe(false);
    await expect(
      alepha.inject(MySecondMemoryProvider).exists(app.gn.name, fileId),
    ).resolves.toBe(true);
  });
});
