import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $action, $route, HttpError, ServerProvider } from "../index.ts";
import {
  bodyParserOptions,
  ServerBodyParserProvider,
} from "../providers/ServerBodyParserProvider.ts";

describe("ServerBodyParserProvider", () => {
  it("should parse JSON body", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      json = $action({
        method: "POST",
        path: "/json",
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

    // Over HTTP: `run()` hands the body to the handler and parses nothing.
    const response = await app.json.fetch({
      body: { message: "Hello, World!" },
    });
    expect(response.data).toEqual({
      received: "Hello, World!",
    });

    expect(app.json.getBodyContentType()).toBe("application/json");
  });

  it("should parse text body", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      text = $action({
        method: "POST",
        path: "/text",
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

    const response = await app.text.fetch({
      body: "Hello, World!",
    });
    expect(response.data).toEqual({
      received: "Hello, World!",
    });

    expect(app.text.getBodyContentType()).toBe("text/plain");
  });

  it("should reject payload exceeding size limit", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      test = $action({
        method: "POST",
        path: "/test",
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
      name: "PAYLOAD_TOO_LARGE",
      message: "Request body size limit exceeded",
      data: { status: 413, requestId: expect.any(String) },
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

    // "brotli" is not a valid encoding name, only "br" is
    await expect(
      parser.parseJson(makeStream(), "brotli" as string),
    ).rejects.toThrow("Unsupported Content-Encoding: brotli");
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

    await expect(parser.parseText(stream, "gzip")).rejects.toThrow(
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

    await expect(parser.parseText(stream)).rejects.toThrow(
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

  it("should read media types and encodings whatever their case", async ({
    expect,
  }) => {
    class TestApp {
      echo = $route({
        method: "POST",
        path: "/echo",
        schema: { body: z.object({ a: z.text() }) },
        handler: ({ body }) => `got ${body.a}`,
      });
    }

    const alepha = Alepha.create().with(TestApp);
    await alepha.start();
    const url = `${alepha.inject(ServerProvider).hostname}/echo`;
    const post = async (headers: Record<string, string>, body: BodyInit) => {
      const response = await fetch(url, { method: "POST", headers, body });
      return [response.status, await response.text()];
    };

    expect(
      await post(
        { "content-type": "Application/JSON; charset=utf-8" },
        '{"a":"x"}',
      ),
    ).toEqual([200, "got x"]);
    expect(
      await post(
        { "content-type": "APPLICATION/X-WWW-FORM-URLENCODED" },
        "a=y",
      ),
    ).toEqual([200, "got y"]);
    expect(
      await post(
        { "content-type": "application/json", "content-encoding": "GZIP" },
        new Uint8Array(gzipSync('{"a":"z"}')),
      ),
    ).toEqual([200, "got z"]);
  });

  describe("an oversized body with no Content-Length", () => {
    // A chunked body declares no length, so it is refused part-way through
    // and the rest of it is still on the wire. The 413 goes out at once and
    // the rest is discarded, within a budget of bytes and of time; past the
    // budget the connection is closed.
    class TestApp {
      echo = $route({
        method: "POST",
        path: "/echo",
        schema: { body: z.object({ a: z.text({ maxLength: 100_000_000 }) }) },
        handler: () => "ok",
      });

      ping = $route({ path: "/ping", handler: () => "pong" });
    }

    /**
     * The discard budget, small enough for a spec to pass it.
     */
    class SmallDiscard extends ServerBodyParserProvider {
      protected override readonly discardMaxBytes = 256 * 1024;
      protected override readonly discardMaxMillis = 150;
      protected override readonly discardLingerMillis = 150;
    }

    const start = async () => {
      const alepha = Alepha.create()
        .with({ provide: ServerBodyParserProvider, use: SmallDiscard })
        .with(TestApp);
      await alepha.start();
      return new URL(alepha.inject(ServerProvider).hostname);
    };

    const head =
      "POST /echo HTTP/1.1\r\nhost: localhost\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n";

    /**
     * One raw connection: `write` sends its bytes once connected, and the
     * outcome says how the connection ended after the 413 arrived and a
     * second request was written on it.
     */
    const raw = (url: URL, write: (socket: Socket) => void) =>
      new Promise<{ received: string; end: "answered" | "closed" | "hung" }>(
        (resolve) => {
          const socket = connect(Number(url.port), url.hostname);
          let received = "";
          let asked = false;
          const finish = (end: "answered" | "closed" | "hung") => {
            clearTimeout(timer);
            socket.destroy();
            resolve({ received, end });
          };
          const timer = setTimeout(() => finish("hung"), 3000);
          socket.on("data", (data) => {
            received += data.toString();
            if (!asked && /size limit/.test(received)) {
              asked = true;
              socket.write("GET /ping HTTP/1.1\r\nhost: localhost\r\n\r\n");
            }
            if (received.includes("pong")) {
              finish("answered");
            }
          });
          socket.on("close", () => finish("closed"));
          socket.on("error", () => finish("closed"));
          socket.on("connect", () => write(socket));
        },
      );

    it("should keep the connection usable when the rest fits the discard budget", async ({
      expect,
    }) => {
      const url = await start();
      // 200 KB against the 100 KB limit, in several chunks.
      const piece = "x".repeat(50_000);

      const outcome = await raw(url, (socket) => {
        socket.write(head);
        for (let i = 0; i < 4; i++) {
          socket.write(`${piece.length.toString(16)}\r\n${piece}\r\n`);
        }
        socket.write("0\r\n\r\n");
      });

      expect(outcome.received).toContain("HTTP/1.1 413");
      // The request written after it on the same connection is answered.
      expect(outcome.end).toBe("answered");
    });

    it("should close the connection once the rest passes the discard budget", async ({
      expect,
    }) => {
      const url = await start();
      const piece = "x".repeat(64 * 1024);

      const outcome = await raw(url, (socket) => {
        socket.write(head);
        // 1 MB and no end: four times the budget.
        for (let i = 0; i < 16; i++) {
          socket.write(`${piece.length.toString(16)}\r\n${piece}\r\n`);
        }
      });

      expect(outcome.received).toContain("HTTP/1.1 413");
      expect(outcome.end).toBe("closed");
    });

    it("should close the connection when the rest never comes", async ({
      expect,
    }) => {
      const url = await start();
      const piece = "x".repeat(150_000);

      const outcome = await raw(url, (socket) => {
        socket.write(head);
        // Past the limit, under the byte budget, then silence.
        socket.write(`${piece.length.toString(16)}\r\n${piece}\r\n`);
      });

      expect(outcome.received).toContain("HTTP/1.1 413");
      expect(outcome.end).toBe("closed");
    });

    it("should answer 413 to a client still uploading far more than the budget, every time", async ({
      expect,
    }) => {
      const url = await start();
      // 4 MB: sixteen times the discard budget of this spec.
      const body = Buffer.alloc(4 * 1024 * 1024, "x");

      const upload = () =>
        new Promise<number | string>((resolve) => {
          const req = request(
            {
              host: url.hostname,
              port: url.port,
              path: "/echo",
              method: "POST",
              headers: {
                "content-type": "application/json",
                "transfer-encoding": "chunked",
              },
            },
            (res) => {
              resolve(res.statusCode ?? "no status");
              // Answered: stop uploading, as a client does.
              res.on("error", () => {});
              req.destroy();
            },
          );
          req.on("error", (error: NodeJS.ErrnoException) =>
            resolve(error.code ?? error.message),
          );
          req.write('{"a":"');
          req.write(body);
          req.end('"}');
        });

      const statuses: Array<number | string> = [];
      for (let i = 0; i < 20; i++) {
        statuses.push(await upload());
      }

      expect(statuses).toEqual(Array.from({ length: 20 }, () => 413));

      // The server itself is unharmed.
      const ping = await fetch(`${url.origin}/ping`);
      expect(await ping.text()).toBe("pong");
    });
  });
});
