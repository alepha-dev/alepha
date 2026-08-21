import { Readable } from "node:stream";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { FileDetector } from "../services/FileDetector.ts";

/**
 * `peekBytes` read the WHOLE stream to look at the first 16 bytes, then rebuilt
 * a new stream from the buffered copy. `detectFileType` on a multi-GB upload
 * therefore materialised the entire file in memory before anything downstream
 * saw a byte.
 */
class Probe extends FileDetector {
  public peek(stream: Readable, n: number) {
    return this.peekBytes(stream, n);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const probe = alepha.inject(Probe);
  await alepha.start();
  return probe;
};

/** A stream that records how many chunks were actually pulled from it. */
const countingStream = (chunks: Buffer[]) => {
  let pulled = 0;
  const stream = Readable.from(
    (function* () {
      for (const chunk of chunks) {
        pulled++;
        yield chunk;
      }
    })(),
  );
  return { stream, pulled: () => pulled };
};

describe("FileDetector.peekBytes", () => {
  it("stops reading once it has the bytes it needs", async () => {
    const probe = await setup();

    // 64 chunks of 1 KiB. Peeking 16 bytes must not pull all 64.
    const chunks = Array.from({ length: 64 }, (_, i) =>
      Buffer.alloc(1024, i % 256),
    );
    const { stream, pulled } = countingStream(chunks);

    const result = await probe.peek(stream, 16);

    expect(result.buffer.length).toBe(16);
    expect(pulled()).toBeLessThan(64);
  });

  it("returns the correct leading bytes", async () => {
    const probe = await setup();
    const stream = Readable.from([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2048, 7),
    ]);

    const result = await probe.peek(stream, 8);

    expect([...result.buffer]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("hands back a stream that still yields the full payload", async () => {
    const probe = await setup();
    const payload = Buffer.concat([
      Buffer.from("HEADER--"),
      Buffer.alloc(5000, 3),
    ]);
    const stream = Readable.from([payload]);

    const result = await probe.peek(stream, 8);

    const out: Buffer[] = [];
    for await (const chunk of result.stream) {
      out.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(out).equals(payload)).toBe(true);
  });

  it("copes with a stream shorter than the requested peek", async () => {
    const probe = await setup();
    const stream = Readable.from([Buffer.from([1, 2, 3])]);

    const result = await probe.peek(stream, 16);

    expect([...result.buffer]).toEqual([1, 2, 3]);

    const out: Buffer[] = [];
    for await (const chunk of result.stream) {
      out.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    // The spread is load-bearing: it turns the Buffer into a plain array so
    // `toEqual` compares element-wise rather than Buffer-to-array.
    // oxlint-disable-next-line unicorn/no-useless-spread
    expect([...Buffer.concat(out)]).toEqual([1, 2, 3]);
  });

  it("copes with an empty stream", async () => {
    const probe = await setup();

    const result = await probe.peek(Readable.from([]), 16);

    expect(result.buffer.length).toBe(0);
  });
});
