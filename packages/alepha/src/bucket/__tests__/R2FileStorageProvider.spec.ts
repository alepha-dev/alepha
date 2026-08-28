import { Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { beforeEach, describe, expect, test } from "vitest";

import { R2FileStorageProvider } from "../providers/R2FileStorageProvider.ts";
import {
  TEST_IMAGES_BUCKET,
  testCustomFileId,
  testDeleteFile,
  testDeleteNonExistentFile,
  testDownloadAndMetadata,
  testUploadedNameAndTypeSurvive,
  testEmptyFiles,
  testFileExistence,
  testFileStream,
  testKeepsTheStatusOfAStreamRefusal,
  testListFiles,
  testNonExistentFile,
  testNonExistentFileError,
  testUploadAndExistence,
  testUploadIntoBuckets,
} from "./shared.ts";

/**
 * `R2FileStorageProvider` is the production default on Cloudflare Workers and
 * had no spec at all — it was the one storage backend whose behaviour nothing
 * pinned, on the one runtime that cannot be exercised locally.
 *
 * The R2 binding is an object supplied by the Workers runtime, so it is faked
 * here rather than the provider being mocked: every code path in the provider
 * runs for real against an in-memory bucket that mirrors the documented R2
 * semantics (put/get/head/delete/list, single-use `body`, `customMetadata`).
 */
class FakeR2Object {
  constructor(
    public readonly key: string,
    public readonly value: Uint8Array,
    public readonly httpMetadata: { contentType?: string },
    public readonly customMetadata: Record<string, string>,
    public readonly uploaded: Date,
  ) {}

  get size() {
    return this.value.byteLength;
  }

  /**
   * R2 hands back a single-use body. Reading it twice is a runtime error, and
   * the provider's `FileLike` exposes `stream()`, `arrayBuffer()` and `text()`
   * over this one object — so the fake enforces the constraint instead of
   * quietly allowing what production would reject.
   */
  protected consumed = false;

  protected take(): Uint8Array {
    if (this.consumed) {
      throw new Error("R2 object body already used");
    }
    this.consumed = true;
    return this.value;
  }

  get body() {
    const bytes = this.take();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async arrayBuffer() {
    const bytes = this.take();
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async text() {
    return new TextDecoder().decode(this.take());
  }
}

class FakeR2Bucket {
  public readonly objects = new Map<string, FakeR2Object>();
  private clock = 0;

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) {
    const bytes =
      value instanceof Uint8Array
        ? value
        : new Uint8Array(value as ArrayBuffer);
    this.objects.set(
      key,
      new FakeR2Object(
        key,
        bytes,
        options?.httpMetadata ?? {},
        options?.customMetadata ?? {},
        new Date(++this.clock),
      ),
    );
  }

  /**
   * A fresh object each time, so one download cannot drain another.
   */
  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return new FakeR2Object(
      stored.key,
      stored.value,
      stored.httpMetadata,
      stored.customMetadata,
      stored.uploaded,
    );
  }

  async head(key: string) {
    return this.objects.has(key) ? (this.objects.get(key) as never) : null;
  }

  async delete(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) {
      this.objects.delete(k);
    }
  }

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? "";
    return {
      objects: [...this.objects.values()].filter((o) =>
        o.key.startsWith(prefix),
      ),
    };
  }
}

let alepha: Alepha;
let provider: R2FileStorageProvider;
let r2: FakeR2Bucket;

const setup = async (env: Record<string, string> = {}) => {
  r2 = new FakeR2Bucket();
  alepha = Alepha.create({
    env: { LOG_LEVEL: "error", R2_BUCKET_NAME: "storage", ...env },
  });
  // The Workers runtime puts bindings here; the provider reads its bucket out
  // of this store on `start`.
  alepha.store.set("cloudflare.env", { storage: r2 } as never);
  provider = alepha.inject(R2FileStorageProvider);
  await alepha.start();
  return provider;
};

const fileOf = (text: string, name: string, type: string) =>
  Alepha.create().inject(FileSystemProvider).createFile({ text, name, type });

describe("R2FileStorageProvider", () => {
  beforeEach(async () => {
    await setup();
  });

  describe("storage contract (shared with every other provider)", () => {
    test("uploads a file and reports it exists", async () => {
      await testUploadAndExistence(provider);
    });

    test("downloads with metadata intact", async () => {
      await testDownloadAndMetadata(provider);
    });

    test("should keep the uploaded name and type", async () => {
      await testUploadedNameAndTypeSurvive(provider);
    });

    test("reports existence correctly", async () => {
      await testFileExistence(provider);
    });

    test("reports a missing file as absent", async () => {
      await testNonExistentFile(provider);
    });

    test("throws when downloading a missing file", async () => {
      await testNonExistentFileError(provider);
    });

    test("throws when deleting a missing file", async () => {
      await testDeleteNonExistentFile(provider);
    });

    test("deletes a file", async () => {
      await testDeleteFile(provider);
    });

    test("keeps containers separate", async () => {
      await testUploadIntoBuckets(provider);
    });

    test("streams a file", async () => {
      await testFileStream(provider);
    });

    test("handles empty files", async () => {
      await testEmptyFiles(provider);
    });

    test("keeps the status of a refusal raised mid-stream", async () => {
      await testKeepsTheStatusOfAStreamRefusal(provider);
    });

    test("lists files", async () => {
      await testListFiles(provider);
    });

    test("accepts a caller-supplied file id", async () => {
      await testCustomFileId(provider);
    });
  });

  describe("R2 specifics", () => {
    test("keys objects under {prefix}/{container}/{fileId}", async () => {
      const p = await setup({ APP_NAME: "myapp" });
      const id = await p.upload(
        TEST_IMAGES_BUCKET,
        fileOf("x", "a.png", "image/png"),
      );

      expect([...r2.objects.keys()]).toEqual([
        `myapp/${TEST_IMAGES_BUCKET}/${id}`,
      ]);
    });

    test("omits the prefix when APP_NAME is unset", async () => {
      const id = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("x", "a.png", "image/png"),
      );

      expect([...r2.objects.keys()]).toEqual([`${TEST_IMAGES_BUCKET}/${id}`]);
    });

    test("round-trips the original filename through customMetadata", async () => {
      const id = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("x", "Report Q3.pdf", "application/pdf"),
      );

      const file = await provider.download(TEST_IMAGES_BUCKET, id);
      expect(file.name).toBe("Report Q3.pdf");
      expect(file.type).toBe("application/pdf");
    });

    /**
     * R2 hands back a single-use body, and the provider's `FileLike` exposed
     * `stream()`, `arrayBuffer()` and `text()` over that one object — so
     * reading twice threw, while Memory and Local happily serve repeat reads.
     * Same call, different behaviour per backend.
     */
    test("serves repeat reads like every other provider", async () => {
      const id = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("hello", "a.txt", "text/plain"),
      );
      const file = await provider.download(TEST_IMAGES_BUCKET, id);

      expect(await file.text()).toBe("hello");
      expect(await file.text()).toBe("hello");
    });

    test("serves mixed accessors over the same download", async () => {
      const id = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("hello", "a.txt", "text/plain"),
      );
      const file = await provider.download(TEST_IMAGES_BUCKET, id);

      expect(await file.text()).toBe("hello");
      expect(new Uint8Array(await file.arrayBuffer())).toHaveLength(5);

      const reader = (
        file.stream() as unknown as ReadableStream<Uint8Array>
      ).getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("hello");
    });

    test("deleteMany removes every id and tolerates unknown ones", async () => {
      const a = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("a", "a.txt", "text/plain"),
      );
      const b = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("b", "b.txt", "text/plain"),
      );

      await provider.deleteMany(TEST_IMAGES_BUCKET, [a, b, "never-existed"]);

      expect(await provider.exists(TEST_IMAGES_BUCKET, a)).toBe(false);
      expect(await provider.exists(TEST_IMAGES_BUCKET, b)).toBe(false);
    });

    test("deleteMany on an empty list touches nothing", async () => {
      const id = await provider.upload(
        TEST_IMAGES_BUCKET,
        fileOf("a", "a.txt", "text/plain"),
      );

      await provider.deleteMany(TEST_IMAGES_BUCKET, []);

      expect(await provider.exists(TEST_IMAGES_BUCKET, id)).toBe(true);
    });

    /**
     * The container wraps a failing start hook, so assert on the cause.
     */
    const startFailureCause = async (app: Alepha): Promise<string> => {
      try {
        await app.start();
      } catch (error) {
        let current = error as { message?: string; cause?: unknown };
        const messages: string[] = [];
        while (current) {
          if (current.message) messages.push(current.message);
          current = current.cause as typeof current;
        }
        return messages.join(" | ");
      }
      throw new Error("expected start() to reject");
    };

    test("refuses to start without the binding", async () => {
      const app = Alepha.create({
        env: { LOG_LEVEL: "error", R2_BUCKET_NAME: "storage" },
      });
      app.store.set("cloudflare.env", {} as never);
      app.inject(R2FileStorageProvider);

      expect(await startFailureCause(app)).toMatch(
        /binding 'storage' not found/,
      );
    });

    test("refuses to start outside a Workers environment", async () => {
      const app = Alepha.create({
        env: { LOG_LEVEL: "error", R2_BUCKET_NAME: "storage" },
      });
      app.inject(R2FileStorageProvider);

      expect(await startFailureCause(app)).toMatch(
        /Cloudflare Workers environment not found/,
      );
    });
  });
});
