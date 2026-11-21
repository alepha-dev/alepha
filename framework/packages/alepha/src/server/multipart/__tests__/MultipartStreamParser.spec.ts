import { describe, it } from "vitest";

import {
  MultipartLimitError,
  MultipartParseError,
  MultipartStreamParser,
} from "../helpers/MultipartStreamParser.ts";

const BOUNDARY = "----AlephaBoundary";

/**
 * Builds a multipart body from parts, exactly as a client would.
 */
const bodyOf = (
  parts: Array<{ headers: string; content: string }>,
  options: { preamble?: string; epilogue?: string } = {},
): Uint8Array => {
  let raw = options.preamble ?? "";
  for (const part of parts) {
    raw += `--${BOUNDARY}\r\n${part.headers}\r\n\r\n${part.content}\r\n`;
  }
  raw += `--${BOUNDARY}--\r\n${options.epilogue ?? ""}`;
  return new TextEncoder().encode(raw);
};

const filePart = (name: string, filename: string, content: string) => ({
  headers: `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream`,
  content,
});

/**
 * Feeds bytes as a stream, cut into chunks of exactly `size`.
 *
 * The chunk size is the whole point of this helper: it is the axis along which
 * a multipart parser breaks, and the only way to find out is to vary it.
 */
const streamOf = (
  bytes: Uint8Array,
  size: number,
): ReadableStream<Uint8Array> => {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + size));
      offset += size;
    },
  });
};

/**
 * Parses a body and collects every part with its content as text.
 */
const collect = async (
  bytes: Uint8Array,
  chunkSize = 64 * 1024,
  options = {},
): Promise<Array<{ name?: string; filename?: string; content: string }>> => {
  const parser = new MultipartStreamParser({
    maxParts: 100,
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024,
    ...options,
  });
  const out: Array<{ name?: string; filename?: string; content: string }> = [];

  for await (const part of parser.parse(streamOf(bytes, chunkSize), BOUNDARY)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of part.data) {
      chunks.push(chunk);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.length;
    }
    out.push({
      name: part.name,
      filename: part.filename,
      content: new TextDecoder().decode(joined),
    });
  }
  return out;
};

/**
 * Exposes what the parser holds, so a test can assert on retention directly.
 */
class ProbeParser extends MultipartStreamParser {
  public get buffered(): number {
    return this.buffer.length;
  }

  public get billed(): number {
    return this.totalSize;
  }
}

describe("MultipartStreamParser", () => {
  it("reads a single file part", async ({ expect }) => {
    const body = bodyOf([filePart("file", "a.txt", "hello")]);

    const parts = await collect(body);

    expect(parts).toEqual([
      { name: "file", filename: "a.txt", content: "hello" },
    ]);
  });

  it("reads several parts, files and fields alike", async ({ expect }) => {
    const body = bodyOf([
      {
        headers: 'Content-Disposition: form-data; name="title"',
        content: "A title",
      },
      filePart("file", "a.bin", "BYTES"),
      { headers: 'Content-Disposition: form-data; name="tag"', content: "x" },
    ]);

    const parts = await collect(body);

    expect(parts.map((p) => p.name)).toEqual(["title", "file", "tag"]);
    expect(parts[1].filename).toBe("a.bin");
    expect(parts.map((p) => p.content)).toEqual(["A title", "BYTES", "x"]);
  });

  it("ignores the preamble and the epilogue", async ({ expect }) => {
    const body = bodyOf([filePart("file", "a.txt", "hello")], {
      preamble: "This is a multipart message.\r\n",
      epilogue: "trailing noise nobody should read",
    });

    const parts = await collect(body);

    expect(parts).toEqual([
      { name: "file", filename: "a.txt", content: "hello" },
    ]);
  });

  /**
   * The case the parser exists to get right.
   *
   * A delimiter can land across two chunks, so the same body cut at every
   * possible offset has to produce the same parts. This is the only test here
   * that would have caught a hold-back off by one byte, and it catches it at
   * whichever offset happens to expose it rather than the one someone guessed.
   */
  it("gives the same answer at every possible chunk boundary", async ({
    expect,
  }) => {
    const body = bodyOf([
      {
        headers: 'Content-Disposition: form-data; name="title"',
        content: "A title",
      },
      filePart(
        "file",
        "a.bin",
        "line one\r\nline two\r\n--not-the-boundary\r\n",
      ),
    ]);
    const expected = await collect(body, body.length);

    for (let size = 1; size <= body.length; size++) {
      const parts = await collect(body, size);
      expect(parts, `chunk size ${size}`).toEqual(expected);
    }
  });

  it("does not truncate content that looks like a boundary", async ({
    expect,
  }) => {
    // A body whose content contains the delimiter's prefix but not the
    // delimiter: a parser that matches too eagerly cuts the part in half here.
    const content = `--${BOUNDARY}x not the end\r\n--${BOUNDARY.slice(0, 10)}`;
    const body = bodyOf([filePart("file", "a.bin", content)]);

    const parts = await collect(body, 7);

    expect(parts[0].content).toBe(content);
  });

  it("preserves bytes that are not valid UTF-8", async ({ expect }) => {
    const head = new TextEncoder().encode(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"; filename="a.bin"\r\n\r\n`,
    );
    const raw = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x0d, 0x0a, 0x42]);
    const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);
    const body = new Uint8Array(head.length + raw.length + tail.length);
    body.set(head, 0);
    body.set(raw, head.length);
    body.set(tail, head.length + raw.length);

    const parser = new MultipartStreamParser();
    const seen: number[] = [];
    for await (const part of parser.parse(streamOf(body, 3), BOUNDARY)) {
      for await (const chunk of part.data) {
        seen.push(...chunk);
      }
    }

    expect(seen).toEqual([...raw]);
  });

  it("reads an empty part", async ({ expect }) => {
    const body = bodyOf([
      { headers: 'Content-Disposition: form-data; name="empty"', content: "" },
    ]);

    const parts = await collect(body, 5);

    expect(parts).toEqual([
      { name: "empty", filename: undefined, content: "" },
    ]);
  });

  describe("filenames", () => {
    it("reads a quoted filename containing a semicolon", async ({ expect }) => {
      const body = bodyOf([filePart("file", "a;b.txt", "x")]);

      const parts = await collect(body);

      expect(parts[0].filename).toBe("a;b.txt");
    });

    it("prefers the RFC 5987 filename* over the ASCII fallback", async ({
      expect,
    }) => {
      const body = bodyOf([
        {
          headers:
            'Content-Disposition: form-data; name="file"; filename="fallback.txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.txt',
          content: "x",
        },
      ]);

      const parts = await collect(body);

      expect(parts[0].filename).toBe("résumé.txt");
    });

    it("falls back to the ASCII filename when filename* is malformed", async ({
      expect,
    }) => {
      const body = bodyOf([
        {
          headers:
            'Content-Disposition: form-data; name="file"; filename="fallback.txt"; filename*=UTF-8\'\'%E0%A4%A',
          content: "x",
        },
      ]);

      const parts = await collect(body);

      expect(parts[0].filename).toBe("fallback.txt");
    });

    it("reads the field name when filename comes first", async ({ expect }) => {
      // `name=` is a substring of `filename=`, so an unanchored search finds the
      // filename's value and calls it the field name. Nothing mandates the
      // order, so the only thing keeping this from firing is client habit,
      // and the field a part lands in is not something the sender should pick.
      const body = bodyOf([
        {
          headers:
            'Content-Disposition: form-data; filename="evil.txt"; name="avatar"',
          content: "x",
        },
      ]);

      const parts = await collect(body);

      expect(parts[0].name).toBe("avatar");
      expect(parts[0].filename).toBe("evil.txt");
    });

    it("reads an unquoted field name when filename comes first", async ({
      expect,
    }) => {
      const body = bodyOf([
        {
          headers:
            "Content-Disposition: form-data; filename=evil.txt; name=avatar",
          content: "x",
        },
      ]);

      const parts = await collect(body);

      expect(parts[0].name).toBe("avatar");
      expect(parts[0].filename).toBe("evil.txt");
    });
  });

  describe("limits", () => {
    it("refuses a part larger than maxFileBytes, counting bytes rather than trusting a header", async ({
      expect,
    }) => {
      const body = bodyOf([filePart("file", "a.bin", "x".repeat(5000))]);

      await expect(collect(body, 64, { maxFileBytes: 1000 })).rejects.toThrow(
        MultipartLimitError,
      );
    });

    it("refuses a message larger than maxTotalBytes even when each part fits", async ({
      expect,
    }) => {
      const body = bodyOf([
        filePart("a", "a.bin", "x".repeat(600)),
        filePart("b", "b.bin", "x".repeat(600)),
      ]);

      await expect(
        collect(body, 64, { maxFileBytes: 1000, maxTotalBytes: 1000 }),
      ).rejects.toThrow(MultipartLimitError);
    });

    it("refuses more parts than maxParts", async ({ expect }) => {
      const body = bodyOf([
        filePart("a", "a.bin", "x"),
        filePart("b", "b.bin", "x"),
        filePart("c", "c.bin", "x"),
      ]);

      await expect(collect(body, 64, { maxParts: 2 })).rejects.toThrow(
        MultipartLimitError,
      );
    });

    it("refuses headers larger than maxHeaderBytes, however the stream is cut", async ({
      expect,
    }) => {
      const body = bodyOf([
        {
          headers: `Content-Disposition: form-data; name="f"\r\nX-Padding: ${"p".repeat(5000)}`,
          content: "x",
        },
      ]);

      // 64 KiB is what a socket delivers: the whole header block and its blank
      // line land in one chunk.
      for (const chunkSize of [128, 64 * 1024]) {
        await expect(
          collect(body, chunkSize, { maxHeaderBytes: 512 }),
          `chunk size ${chunkSize}`,
        ).rejects.toThrow(MultipartLimitError);
      }
    });

    it("accepts headers of exactly maxHeaderBytes, blank line included, however the stream is cut", async ({
      expect,
    }) => {
      const headers = `Content-Disposition: form-data; name="f"\r\nX-Padding: ${"p".repeat(100)}`;
      const body = bodyOf([{ headers, content: "x" }]);
      const exact = headers.length + 4;

      for (const chunkSize of [1, 128, 64 * 1024]) {
        const parts = await collect(body, chunkSize, { maxHeaderBytes: exact });
        expect(parts, `chunk size ${chunkSize}`).toHaveLength(1);
        await expect(
          collect(body, chunkSize, { maxHeaderBytes: exact - 1 }),
          `chunk size ${chunkSize}`,
        ).rejects.toThrow(MultipartLimitError);
      }
    });

    it("charges the preamble to maxTotalBytes", async ({ expect }) => {
      // A preamble is discarded, not delivered, but it is still bytes the
      // sender made this process read. Left unbilled, a body that never
      // reaches a boundary spins forever under any budget, and `chunked`
      // carries no Content-Length for the cheap pre-check to catch.
      const body = bodyOf([filePart("f", "a.bin", "x")], {
        preamble: `${"P".repeat(5000)}\r\n`,
      });

      await expect(collect(body, 512, { maxTotalBytes: 1000 })).rejects.toThrow(
        MultipartLimitError,
      );
    });

    it("charges part headers to maxTotalBytes", async ({ expect }) => {
      // Each part's headers fit under maxHeaderBytes; together they are far
      // past the whole message's budget. Billing only content let a sender
      // spend an arbitrary amount in headers spread over many small parts.
      const body = bodyOf(
        Array.from({ length: 20 }, (_, i) => ({
          headers: `Content-Disposition: form-data; name="f${i}"\r\nX-Padding: ${"p".repeat(400)}`,
          content: "x",
        })),
      );

      await expect(
        collect(body, 512, { maxTotalBytes: 1000, maxHeaderBytes: 4096 }),
      ).rejects.toThrow(MultipartLimitError);
    });
  });

  describe("padding after a boundary", () => {
    /**
     * A body that is one delimiter followed by spaces, 64 KiB at a time.
     */
    const paddedStream = (chunks: number, parser: ProbeParser) => {
      const state = { sent: 0, peak: 0, bytes: 0 };
      const head = new TextEncoder().encode(`--${BOUNDARY}`);
      const spaces = new Uint8Array(64 * 1024).fill(0x20);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          state.peak = Math.max(state.peak, parser.buffered);
          if (state.sent === 0) {
            controller.enqueue(head);
            state.bytes += head.length;
          } else if (state.sent <= chunks) {
            controller.enqueue(spaces);
            state.bytes += spaces.length;
          } else {
            controller.close();
          }
          state.sent++;
        },
      });
      return { body, state };
    };

    it("stops reading whitespace after a boundary instead of buffering it", async ({
      expect,
    }) => {
      const parser = new ProbeParser({ maxTotalBytes: 1024 });
      // 10 MiB of spaces.
      const { body, state } = paddedStream(160, parser);

      await expect(async () => {
        for await (const _ of parser.parse(body, BOUNDARY)) {
          // no part can come out of this body
        }
      }).rejects.toThrow(MultipartParseError);

      // What the parser pulled from its source before refusing: the
      // delimiter and the chunk that carried the padding past its cap, plus
      // what the stream's own queue asked for ahead of it.
      const delimiter = BOUNDARY.length + 2;
      expect(state.bytes).toBeLessThanOrEqual(delimiter + 3 * 64 * 1024);
      expect(state.peak).toBeLessThanOrEqual(delimiter + 2 * 64 * 1024);
    });

    it("charges the padding to maxTotalBytes", async ({ expect }) => {
      const raw =
        `--${BOUNDARY}${" ".repeat(200)}\r\n` +
        `Content-Disposition: form-data; name="f"\r\n\r\n` +
        `x\r\n` +
        `--${BOUNDARY}--\r\n`;
      const bytes = new TextEncoder().encode(raw);

      for (const chunkSize of [16, 64 * 1024]) {
        const parts = await collect(bytes, chunkSize, { maxTotalBytes: 300 });
        expect(parts, `chunk size ${chunkSize}`).toHaveLength(1);

        const refusal = await collect(bytes, chunkSize, {
          maxTotalBytes: 150,
        }).catch((error) => error);
        expect(refusal, `chunk size ${chunkSize}`).toBeInstanceOf(
          MultipartLimitError,
        );
        expect(refusal.data.kind).toBe("total");
      }
    });

    it("refuses more padding than a sender has a use for, whatever the budget", async ({
      expect,
    }) => {
      const raw =
        `--${BOUNDARY}${" ".repeat(5000)}\r\n` +
        `Content-Disposition: form-data; name="f"\r\n\r\n` +
        `x\r\n` +
        `--${BOUNDARY}--\r\n`;
      const bytes = new TextEncoder().encode(raw);

      for (const chunkSize of [16, 64 * 1024]) {
        await expect(
          collect(bytes, chunkSize),
          `chunk size ${chunkSize}`,
        ).rejects.toThrow(MultipartParseError);
      }
    });
  });

  describe("malformed bodies", () => {
    it("refuses a body with no boundary at all", async ({ expect }) => {
      const body = new TextEncoder().encode("just some bytes");

      await expect(collect(body)).rejects.toThrow(MultipartParseError);
    });

    it("refuses a body that ends inside a part", async ({ expect }) => {
      const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"\r\n\r\nunterminated`;

      await expect(collect(new TextEncoder().encode(raw))).rejects.toThrow(
        MultipartParseError,
      );
    });

    it("refuses a body that ends inside the headers", async ({ expect }) => {
      const raw = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"`;

      await expect(collect(new TextEncoder().encode(raw))).rejects.toThrow(
        MultipartParseError,
      );
    });

    it("accepts linear whitespace after a boundary, however the stream is cut", async ({
      expect,
    }) => {
      // RFC 2046 tolerates spaces and tabs between a delimiter and its CRLF.
      // `want(2)` runs *before* those are consumed, so once they are, the CRLF
      // test can read past the buffer and call a well-formed body malformed:
      // an upload that fails or not depending on where TCP split it.
      const raw =
        `--${BOUNDARY} \t\r\n` +
        `Content-Disposition: form-data; name="f"\r\n\r\n` +
        `x\r\n` +
        `--${BOUNDARY}--\r\n`;
      const bytes = new TextEncoder().encode(raw);

      for (let chunkSize = 1; chunkSize <= 8; chunkSize++) {
        const parts = await collect(bytes, chunkSize);
        expect(parts, `chunk size ${chunkSize}`).toEqual([
          { name: "f", filename: undefined, content: "x" },
        ]);
      }
    });

    it("refuses to read a part's data twice", async ({ expect }) => {
      const parser = new MultipartStreamParser();
      const body = bodyOf([filePart("file", "a.txt", "hello")]);

      for await (const part of parser.parse(streamOf(body, 512), BOUNDARY)) {
        for await (const _ of part.data) {
          // drain
        }
        // The second pass has nothing to give: the bytes are gone by design,
        // and saying so beats handing back an empty stream that reads as "the
        // file was empty".
        await expect(async () => {
          for await (const _ of part.data) {
            // unreachable
          }
        }).rejects.toThrow(MultipartParseError);
      }
    });
  });

  describe("skipping", () => {
    it("walks past a part the consumer ignored", async ({ expect }) => {
      const parser = new MultipartStreamParser();
      const body = bodyOf([
        filePart("skipped", "a.bin", "x".repeat(2000)),
        filePart("wanted", "b.bin", "the one we want"),
      ]);

      const seen: string[] = [];
      for await (const part of parser.parse(streamOf(body, 37), BOUNDARY)) {
        if (part.name !== "wanted") {
          continue; // deliberately not drained
        }
        // Joined, not `chunks[0]`: content arrives in as many pieces as the
        // source happened to deliver, and reading only the first is how a test
        // passes on a big chunk size and fails on a small one.
        let text = "";
        const decoder = new TextDecoder();
        for await (const chunk of part.data) {
          text += decoder.decode(chunk, { stream: true });
        }
        seen.push(text + decoder.decode());
      }

      expect(seen).toEqual(["the one we want"]);
    });
  });

  describe("partial reads", () => {
    it("drains what a consumer left of a part it stopped reading", async ({
      expect,
    }) => {
      const body = bodyOf([
        filePart("a", "a.bin", "x".repeat(3000)),
        filePart("b", "b.bin", "second"),
      ]);

      for (const chunkSize of [100, 64 * 1024]) {
        const parser = new MultipartStreamParser();
        const seen: Array<[string | undefined, string]> = [];
        for await (const part of parser.parse(
          streamOf(body, chunkSize),
          BOUNDARY,
        )) {
          if (part.name === "a") {
            for await (const _ of part.data) {
              break;
            }
            seen.push([part.name, ""]);
            continue;
          }
          let text = "";
          const decoder = new TextDecoder();
          for await (const chunk of part.data) {
            text += decoder.decode(chunk, { stream: true });
          }
          seen.push([part.name, text + decoder.decode()]);
        }

        expect(seen, `chunk size ${chunkSize}`).toEqual([
          ["a", ""],
          ["b", "second"],
        ]);
      }
    });

    it("does not end the message when the unread remainder starts with two hyphens", async ({
      expect,
    }) => {
      // Fed in one chunk the first read hands out everything but the hold-back,
      // which is the delimiter's length minus one: the remainder then starts
      // exactly where this content puts its hyphens.
      const delimiterLength = `\r\n--${BOUNDARY}`.length;
      const tail = `--${"y".repeat(delimiterLength - 3)}`;
      const first = new TextEncoder().encode(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\n${"x".repeat(500)}${tail}`,
      );
      const rest = new TextEncoder().encode(
        `\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="b"\r\n\r\nsecond\r\n--${BOUNDARY}--\r\n`,
      );
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 0) {
            controller.enqueue(first);
          } else if (sent === 1) {
            controller.enqueue(rest);
          } else {
            controller.close();
          }
          sent++;
        },
      });

      const names: Array<string | undefined> = [];
      for await (const part of new MultipartStreamParser().parse(
        body,
        BOUNDARY,
      )) {
        names.push(part.name);
        for await (const _ of part.data) {
          break;
        }
      }

      expect(names).toEqual(["a", "b"]);
    });

    it("keeps counting a part against maxFileBytes after the consumer stopped reading it", async ({
      expect,
    }) => {
      const body = bodyOf([
        filePart("a", "a.bin", "x".repeat(3000)),
        filePart("b", "b.bin", "second"),
      ]);

      await expect(async () => {
        const parser = new MultipartStreamParser({ maxFileBytes: 2000 });
        for await (const part of parser.parse(streamOf(body, 100), BOUNDARY)) {
          for await (const _ of part.data) {
            break;
          }
        }
      }).rejects.toThrow(MultipartLimitError);
    });
  });

  describe("boundaryOf", () => {
    it("reads an unquoted boundary", ({ expect }) => {
      const parser = new MultipartStreamParser();

      expect(parser.boundaryOf("multipart/form-data; boundary=abc123")).toBe(
        "abc123",
      );
    });

    it("reads a quoted boundary containing a semicolon", ({ expect }) => {
      const parser = new MultipartStreamParser();

      expect(parser.boundaryOf('multipart/form-data; boundary="a;b"')).toBe(
        "a;b",
      );
    });

    it("answers undefined for a content type that is not multipart", ({
      expect,
    }) => {
      const parser = new MultipartStreamParser();

      expect(parser.boundaryOf("application/json")).toBeUndefined();
      expect(parser.boundaryOf(undefined)).toBeUndefined();
    });

    it("refuses a multipart type with no boundary", ({ expect }) => {
      const parser = new MultipartStreamParser();

      expect(() => parser.boundaryOf("multipart/form-data")).toThrow(
        MultipartParseError,
      );
    });

    it("refuses a boundary longer than RFC 2046 allows", ({ expect }) => {
      const parser = new MultipartStreamParser();

      expect(() =>
        parser.boundaryOf(`multipart/form-data; boundary=${"x".repeat(71)}`),
      ).toThrow(MultipartParseError);
    });
  });

  /**
   * The regression guard for the whole point of this parser.
   *
   * What the parser holds has to stay flat as the payload grows. Asserted on
   * the buffer itself: the bytes of a `Uint8Array` live outside the V8 heap, so
   * `heapUsed` does not move when they are retained, and the process-wide
   * counters that do see them also count garbage not yet collected.
   */
  it("holds one chunk plus a delimiter whatever the payload size", async ({
    expect,
  }) => {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const head = new TextEncoder().encode(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"; filename="big.bin"\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);

    const measure = async (megabytes: number) => {
      const parser = new ProbeParser({
        maxFileBytes: 512 * 1024 * 1024,
        maxTotalBytes: 512 * 1024 * 1024,
      });
      let emitted = 0;
      let peak = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          peak = Math.max(peak, parser.buffered);
          if (emitted === 0) {
            controller.enqueue(head);
          } else if (emitted <= megabytes * 16) {
            controller.enqueue(chunk);
          } else {
            controller.enqueue(tail);
            controller.close();
          }
          emitted++;
        },
      });

      let delivered = 0;
      for await (const part of parser.parse(body, BOUNDARY)) {
        for await (const piece of part.data) {
          peak = Math.max(peak, parser.buffered);
          delivered += piece.length;
        }
      }
      return { peak, delivered };
    };

    const small = await measure(8);
    const large = await measure(64);

    expect(small.delivered).toBe(8 * 1024 * 1024);
    expect(large.delivered).toBe(64 * 1024 * 1024);
    expect(large.peak).toBeLessThanOrEqual(chunk.length + 2 * BOUNDARY.length);
    expect(large.peak).toBe(small.peak);
  });
});
