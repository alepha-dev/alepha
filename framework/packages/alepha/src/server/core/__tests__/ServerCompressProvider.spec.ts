import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { Alepha } from "alepha";
import { $action, $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  compressOptions,
  ServerCompressProvider,
} from "../providers/ServerCompressProvider.ts";

class App {
  hello = $action({
    path: "/hello",
    method: "GET",
    // Above the default 1 KiB threshold, so it is worth compressing.
    handler: () => "Hello, world! ".repeat(100),
  });

  tiny = $action({
    path: "/tiny",
    method: "GET",
    handler: () => "Hello, world!",
  });
}

class StreamingApp {
  stream = $route({
    path: "/stream",
    handler: async ({ reply }) => {
      const encoder = new TextEncoder();
      reply.setHeader("content-type", "text/html");
      reply.body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("<h1>Hello</h1>"));
          controller.enqueue(encoder.encode("<p>Streaming</p>"));
          controller.enqueue(encoder.encode("<p>Content</p>"));
          controller.close();
        },
      });
    },
  });
}

describe("ServerCompressProvider", () => {
  it("should compress responses with gzip", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("content-encoding")).toBe("gzip");

    await alepha.stop();
  });

  it("should compress responses with brotli", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "br" },
    });

    expect(response.headers.get("content-encoding")).toBe("br");

    await alepha.stop();
  });

  it("should prefer brotli over gzip", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "gzip, br" },
    });

    expect(response.headers.get("content-encoding")).toBe("br");

    await alepha.stop();
  });

  it("should not compress when disabled via atom", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(compressOptions, (old) => ({ ...old, disabled: true }));
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("content-encoding")).toBeNull();

    await alepha.stop();
  });

  it("sends a body below the threshold uncompressed", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/tiny`, {
      headers: { "Accept-Encoding": "gzip, br, zstd" },
    });

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("Hello, world!");

    await alepha.stop();
  });

  it("compresses a small body when the threshold is lowered", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(compressOptions, (old) => ({ ...old, threshold: 0 }));
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/api/tiny`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toBe("Hello, world!");

    await alepha.stop();
  });

  it("should compress streaming responses with gzip", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(StreamingApp);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/stream`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("content-encoding")).toBe("gzip");

    // fetch auto-decompresses, so response.text() gives us the original content
    const text = await response.text();

    expect(text).toContain("<h1>Hello</h1>");
    expect(text).toContain("<p>Streaming</p>");
    expect(text).toContain("<p>Content</p>");

    await alepha.stop();
  });

  it("should compress streaming responses with brotli", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(StreamingApp);
    await alepha.start();

    const server = alepha.inject(ServerProvider);

    const response = await fetch(`${server.hostname}/stream`, {
      headers: { "Accept-Encoding": "br" },
    });

    expect(response.headers.get("content-encoding")).toBe("br");

    const text = await response.text();

    expect(text).toContain("<h1>Hello</h1>");
    expect(text).toContain("<p>Streaming</p>");
    expect(text).toContain("<p>Content</p>");

    await alepha.stop();
  });
});

/**
 * RFC 9110 section 12.5.3. It used to take the first of zstd, br, gzip whose
 * name appeared anywhere in the header, weights ignored.
 */
/**
 * A buffered body up to `SYNC_LIMIT` is compressed synchronously: the async
 * zlib call cost about twice the CPU on a small body. Above it the async path
 * keeps the event loop free. Both must give a body that decompresses to the
 * original, with its length.
 */
describe("ServerCompressProvider sync and async paths", () => {
  class TestCompressProvider extends ServerCompressProvider {
    public testCompress = (encoding: string, response: any) =>
      this.compress(encoding, response);
    public static readonly testLimit = ServerCompressProvider.SYNC_LIMIT;
  }
  const provider = () => Alepha.create().inject(TestCompressProvider);
  const response = (body: string) => ({
    status: 200,
    headers: { "content-type": "application/json" } as Record<string, string>,
    body: body as any,
  });
  const json = (bytes: number) =>
    JSON.stringify({ pad: "x".repeat(bytes - 10) });

  for (const encoding of ["br", "gzip"]) {
    it(`compresses a ${encoding} body under the limit synchronously`, ({
      expect,
    }) => {
      const body = json(8 * 1024);
      const res = response(body);

      const done = provider().testCompress(encoding, res);

      expect(done).toBeUndefined();
      expect(res.headers["content-encoding"]).toBe(encoding);
      expect(res.headers["content-length"]).toBe(String(res.body.length));
      const inflated =
        encoding === "br"
          ? brotliDecompressSync(res.body)
          : gunzipSync(res.body);
      expect(inflated.toString()).toBe(body);
    });

    it(`compresses a ${encoding} body over the limit asynchronously`, async ({
      expect,
    }) => {
      const body = json(TestCompressProvider.testLimit + 1024);
      const res = response(body);

      const done = provider().testCompress(encoding, res);

      expect(done).toBeInstanceOf(Promise);
      await done;
      expect(res.headers["content-encoding"]).toBe(encoding);
      expect(res.headers["content-length"]).toBe(String(res.body.length));
      const inflated =
        encoding === "br"
          ? brotliDecompressSync(res.body)
          : gunzipSync(res.body);
      expect(inflated.toString()).toBe(body);
    });
  }
});

describe("ServerCompressProvider Accept-Encoding", () => {
  class TestCompressProvider extends ServerCompressProvider {
    public testPick = (header: string) => this.pickEncoding(header);
  }
  const pick = (header: string) =>
    Alepha.create().inject(TestCompressProvider).testPick(header);
  const hasZstd = !!ServerCompressProvider.compressors.zstd;

  it("refuses an encoding with q=0", ({ expect }) => {
    expect(pick("br;q=0, gzip;q=1")).toBe("gzip");
  });

  it("lets the highest q win over the server order", ({ expect }) => {
    expect(pick("br;q=0.5, gzip;q=0.9")).toBe("gzip");
  });

  it("breaks a tie with the server order", ({ expect }) => {
    expect(pick("gzip, br")).toBe("br");
  });

  it("gives * to every encoding the header does not name", ({ expect }) => {
    expect(pick("*")).toBe(hasZstd ? "zstd" : "br");
    expect(pick("zstd;q=0, br;q=0, *")).toBe("gzip");
  });

  it("sends identity when *;q=0 refuses everything unnamed", ({ expect }) => {
    expect(pick("*;q=0")).toBeUndefined();
    expect(pick("gzip, *;q=0")).toBe("gzip");
  });

  it("sends identity, never a 406, when identity;q=0 leaves nothing acceptable", ({
    expect,
  }) => {
    expect(pick("identity;q=0")).toBeUndefined();
  });

  it("treats a malformed q as unacceptable", ({ expect }) => {
    expect(pick("br;q=abc, gzip")).toBe("gzip");
    expect(pick("br;q=1.5, gzip;q=0.1")).toBe("gzip");
  });

  it("ignores case and whitespace", ({ expect }) => {
    expect(pick("  GZip ; Q=0.8 ,  BR ; q = 0 ")).toBe("gzip");
  });
});
