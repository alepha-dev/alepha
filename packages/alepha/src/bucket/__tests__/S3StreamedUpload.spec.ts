import { Alepha, type FileLike } from "alepha";
import { afterAll, beforeAll, describe, it } from "vitest";

import { S3FileStorageProvider } from "../providers/S3FileStorageProvider.ts";
import { emptyBuckets, testKeepsTheStatusOfAStreamRefusal } from "./shared.ts";

/**
 * A file whose size is not known until it has been read.
 *
 * This is what a request body looks like once it streams: `size` is 0, and the
 * only way to learn the real length is to consume it — which is precisely what
 * a streamed upload must not require anyone to do up front.
 */
const streamedFile = (megabytes: number, onChunk?: () => void): FileLike => {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  const chunks = megabytes * 16;

  return {
    name: "big.bin",
    type: "application/octet-stream",
    size: 0,
    lastModified: 0,
    stream: () => {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= chunks) {
            controller.close();
            return;
          }
          sent++;
          onChunk?.();
          controller.enqueue(chunk);
        },
      }) as never;
    },
    arrayBuffer: async () => {
      throw new Error(
        "a streamed upload must never ask for the whole payload at once",
      );
    },
    text: async () => {
      throw new Error("not readable as text");
    },
  };
};

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const provider = alepha.inject(S3FileStorageProvider);
  await alepha.start();
  return provider;
};

/**
 * Runs against the `s3mock` container from `compose.yml`, on the endpoint the
 * vitest env already points at. A mock rather than a mock *object*: multipart
 * upload is a three-request protocol with a minimum part size and an ordering
 * rule, and a stub that accepts anything would prove none of it.
 */
describe("S3 streamed upload", () => {
  // From the env, not a literal. The bucket is partitioned per checkout
  // (`test.slot.ts`), so a hardcoded name writes to a bucket the `beforeAll`
  // below did not create - and, when two checkouts run at once, to one the
  // other is emptying.
  const bucket = process.env.S3_BUCKET_NAME!;

  // Provisioned here rather than assumed. The suite passed locally on a mock
  // another spec had already seeded, and failed on CI where the container is
  // new — a test that depends on what someone else left behind is a test that
  // reports the order specs happened to run in.
  beforeAll(async () => {
    await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME}`, {
      method: "PUT",
    });
  });

  // These uploads are the store's whole disk budget: ~70 MB of UUID-named
  // objects per run, into a 4 GB tmpfs that only empties on container
  // restart. Drain the container so consecutive runs start level.
  afterAll(async () => {
    await emptyBuckets(await setup(), [bucket]);
  });

  it("uploads a file whose size is unknown, without ever materialising it", async ({
    expect,
  }) => {
    const provider = await setup();

    // `arrayBuffer()` throws on this file. Reaching for it is the failure mode
    // under test, so the assertion is the absence of that throw.
    const fileId = await provider.upload(bucket, streamedFile(12));

    const stored = await provider.download(bucket, fileId);
    let size = 0;
    for await (const chunk of stored.stream() as AsyncIterable<Uint8Array>) {
      size += chunk.length;
    }
    expect(size).toBe(12 * 1024 * 1024);
  });

  it("uploads a small stream, below one S3 part", async ({ expect }) => {
    const provider = await setup();

    // Under the 5 MiB minimum: the upload has exactly one part, and S3 refuses
    // to complete an upload with none — the case a naive loop skips.
    const fileId = await provider.upload(bucket, streamedFile(1));

    const stored = await provider.download(bucket, fileId);
    let size = 0;
    for await (const chunk of stored.stream() as AsyncIterable<Uint8Array>) {
      size += chunk.length;
    }
    expect(size).toBe(1024 * 1024);
  });

  /**
   * The claim: memory tracks the part size, not the payload.
   */
  it("holds one part, not the whole file", async ({ expect }) => {
    const provider = await setup();

    const measure = async (megabytes: number) => {
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      await provider.upload(
        bucket,
        streamedFile(megabytes, () => {
          const used = process.memoryUsage().heapUsed;
          if (used > peak) {
            peak = used;
          }
        }),
      );
      return peak - before;
    };

    const small = await measure(8);
    const large = await measure(48);

    // Six times the payload. A buffering implementation would show ~40 MB of
    // difference; a multipart one stays near the 5 MiB part it is filling.
    expect(large).toBeLessThan(small + 24 * 1024 * 1024);
  });

  it("keeps the status of a refusal raised mid-stream", async () => {
    const provider = await setup();

    await testKeepsTheStatusOfAStreamRefusal(provider, bucket);
  });
});
