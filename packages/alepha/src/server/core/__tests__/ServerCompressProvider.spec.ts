import { Alepha } from "alepha";
import { $action, $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  compressOptions,
  ServerCompressProvider,
} from "../providers/ServerCompressProvider.ts";

class App {
  hello = $action({
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
