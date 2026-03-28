import { Alepha } from "alepha";
import { $action, $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { compressOptions } from "../providers/ServerCompressProvider.ts";

class App {
  hello = $action({
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
