import { Alepha, z } from "alepha";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import type { MultipartPart } from "alepha/server/multipart";
import { describe, it } from "vitest";

const BOUNDARY = "----AlephaBoundary";

/**
 * A body of `megabytes` megabytes, produced as it is asked for.
 *
 * Never materialised on the sending side either — a test that builds a 100 MB
 * buffer to prove nothing is buffered would prove the opposite about itself.
 */
const bodyOf = (megabytes: number): ReadableStream<Uint8Array> => {
  const head = new TextEncoder().encode(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);
  const chunk = new Uint8Array(64 * 1024).fill(120);
  const chunks = megabytes * 16;
  let sent = 0;

  return new ReadableStream({
    pull(controller) {
      if (sent === 0) {
        controller.enqueue(head);
      } else if (sent <= chunks) {
        controller.enqueue(chunk);
      } else {
        controller.enqueue(tail);
        controller.close();
      }
      sent++;
    },
  });
};

describe("a z.stream() field reaches the handler as bytes in flight", () => {
  const setup = async (maxBytes: number) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    });

    let peak = 0;
    let base = 0;

    class UploadApi {
      upload = $route({
        method: "POST",
        path: "/upload",
        schema: {
          body: z.object({ file: z.stream() }),
        },
        handler: async ({ body }) => {
          const part = body.file as MultipartPart;
          base = process.memoryUsage().heapUsed;
          let size = 0;
          // Thrown away chunk by chunk, which is what a bucket upload does with
          // them. Keeping them would be the very thing under test.
          for await (const chunk of part.data) {
            size += chunk.length;
            const used = process.memoryUsage().heapUsed;
            if (used > peak) {
              peak = used;
            }
          }
          return { size, filename: part.filename } as never;
        },
      });
    }

    alepha.with(AlephaServer);
    alepha.store.set("alepha.server.multipart.options", {
      limit: maxBytes,
      fileLimit: maxBytes,
      fileCount: 10,
    });
    alepha.inject(UploadApi);
    const server = alepha.inject(ServerProvider);
    await alepha.start();

    const send = async (megabytes: number) => {
      const res = await fetch(`${server.hostname}/upload`, {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        body: bodyOf(megabytes),
        duplex: "half",
      } as RequestInit);
      return res;
    };

    return { alepha, send, overhead: () => peak - base };
  };

  it("delivers the filename and every byte", async ({ expect }) => {
    const { alepha, send } = await setup(64 * 1024 * 1024);

    const res = await send(8);
    const body = (await res.json()) as { size: number; filename: string };

    expect(res.status).toBe(200);
    expect(body.filename).toBe("big.bin");
    expect(body.size).toBe(8 * 1024 * 1024);

    await alepha.stop();
  });

  /**
   * The claim the whole module exists for.
   *
   * Eight times the payload must not cost eight times the memory. Measured on
   * the heap rather than RSS: RSS does not shrink after a collection, so it
   * reports garbage as if it were retention.
   */
  it("costs the same memory at 8 MB and at 64 MB", async ({ expect }) => {
    const small = await setup(256 * 1024 * 1024);
    await small.send(8);
    const smallOverhead = small.overhead();
    await small.alepha.stop();

    const large = await setup(256 * 1024 * 1024);
    await large.send(64);
    const largeOverhead = large.overhead();
    await large.alepha.stop();

    // Generous on purpose: this catches a slope, it does not police allocator
    // noise. A buffering implementation would show 56 MB of difference here.
    expect(largeOverhead).toBeLessThan(smallOverhead + 16 * 1024 * 1024);
  });

  it("still refuses a stream past the ceiling, counting as it goes", async ({
    expect,
  }) => {
    const { alepha, send } = await setup(1024 * 1024);

    const res = await send(4);

    expect(res.status).toBe(413);

    await alepha.stop();
  });
});
