import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $action, HttpError } from "../index.ts";
import {
  bodyParserOptions,
  ServerBodyParserProvider,
} from "../providers/ServerBodyParserProvider.ts";

describe("ServerBodyParserProvider", () => {
  it("should parse JSON body", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      json = $action({
        schema: {
          body: z.object({
            message: z.text(),
          }),
          response: z.object({
            received: z.text(),
          }),
        },
        handler: ({ body }) => ({ received: body.message }),
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.json.run({
        body: { message: "Hello, World!" },
      }),
    ).toEqual({
      received: "Hello, World!",
    });

    expect(app.json.getBodyContentType()).toBe("application/json");
  });

  it("should parse text body", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      text = $action({
        schema: {
          body: z.text(),
          response: z.object({
            received: z.text(),
          }),
        },
        handler: ({ body }) => ({ received: body }),
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.text.run({
        body: "Hello, World!",
      }),
    ).toEqual({
      received: "Hello, World!",
    });

    expect(app.text.getBodyContentType()).toBe("text/plain");
  });

  it("should reject payload exceeding size limit", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      test = $action({
        schema: {
          body: z.object({
            message: z.text({
              maxLength: 1_000_000,
            }),
          }),
          response: z.object({
            received: z.text(),
          }),
        },
        handler: ({ body }) => {
          return { received: body.message };
        },
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.test
        .fetch({
          body: { message: "A".repeat(1_000_000) },
        })
        .catch((e) => HttpError.toJSON(e)),
    ).toEqual({
      error: "PayloadTooLargeError",
      status: 413,
      message: "Request body size limit exceeded",
      requestId: expect.any(String),
    });
  });

  it("should decompress gzip body", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const original = JSON.stringify({ hello: "world" });
    const compressed = gzipSync(original);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(compressed));
        controller.close();
      },
    });

    const result = await parser.parseJson(stream, "gzip");
    expect(result).toEqual({ hello: "world" });
  });

  it("should decompress deflate body", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const original = JSON.stringify({ deflated: true });
    const compressed = deflateSync(original);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(compressed));
        controller.close();
      },
    });

    const result = await parser.parseJson(stream, "deflate");
    expect(result).toEqual({ deflated: true });
  });

  it("should decompress brotli body", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const original = JSON.stringify({ brotli: true });
    const compressed = brotliCompressSync(original);

    const makeStream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(compressed));
          controller.close();
        },
      });

    const result = await parser.parseJson(makeStream(), "br");
    expect(result).toEqual({ brotli: true });

    // "brotli" is not a valid encoding name — only "br" is
    await expect(
      parser.parseJson(makeStream(), "brotli" as string),
    ).rejects.toThrowError("Unsupported Content-Encoding: brotli");
  });

  it("should collect all decompressed chunks for large payloads", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.store.mut(bodyParserOptions, () => ({
      inflate: true,
      limit: 200_000,
    }));
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    // Generate a payload large enough that zlib may emit multiple chunks
    const original = JSON.stringify({ data: "X".repeat(50_000) });
    const compressed = gzipSync(original);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(compressed));
        controller.close();
      },
    });

    const result = (await parser.parseJson(stream, "gzip")) as { data: string };
    expect(result.data).toBe("X".repeat(50_000));
  });

  it("should reject compressed body when inflate is disabled", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.store.mut(bodyParserOptions, () => ({
      inflate: false,
      limit: 100_000,
    }));
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const compressed = gzipSync("hello");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(compressed));
        controller.close();
      },
    });

    await expect(parser.parseText(stream, "gzip")).rejects.toThrowError(
      "Content-Encoding gzip not allowed",
    );
  });

  it("should reject unsupported Content-Encoding with 415", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const error = await parser.parseText(stream, "zstd").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(415);
  });

  it("should parse url-encoded body with multi-value keys", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const body = "name=Alice&tag=a&tag=b&tag=c";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });

    const result = await parser.parseUrlEncoded(stream);
    expect(result).toEqual({
      name: "Alice",
      tag: ["a", "b", "c"],
    });
  });

  it("should parse url-encoded body with single values", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const body = "foo=bar&baz=qux";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });

    const result = await parser.parseUrlEncoded(stream);
    expect(result).toEqual({
      foo: "bar",
      baz: "qux",
    });
  });

  it("should pass through identity encoding", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("plain text"));
        controller.close();
      },
    });

    const result = await parser.parseText(stream, "identity");
    expect(result).toBe("plain text");
  });

  it("should return undefined for missing content-type", async ({ expect }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const result = await parser.parse(stream, {}, z.object({}));
    expect(result).toBeUndefined();
  });

  it("should cancel stream reader when body exceeds limit", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.store.mut(bodyParserOptions, () => ({
      inflate: true,
      limit: 10,
    }));
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    let readerCancelled = false;

    // Stream must stay open (not closed) so cancel() is invocable
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("A".repeat(20)));
      },
      cancel() {
        readerCancelled = true;
      },
    });

    await expect(parser.parseText(stream)).rejects.toThrowError(
      "Request body size limit exceeded",
    );

    expect(readerCancelled).toBe(true);
  });

  it("should return undefined for unsupported content-type", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const parser = alepha.inject(ServerBodyParserProvider);
    await alepha.start();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const result = await parser.parse(
      stream,
      { "content-type": "application/octet-stream" },
      z.object({}),
    );
    expect(result).toBeUndefined();
  });
});
