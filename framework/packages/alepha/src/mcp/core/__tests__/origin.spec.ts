import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaMcp, MCP_LEGACY_PROTOCOL_VERSION } from "../index.ts";
import { $tool } from "../primitives/$tool.ts";
import {
  mcpStreamableHttpOptions,
  StreamableHttpMcpTransport,
} from "../transports/StreamableHttpMcpTransport.ts";

/**
 * Origin validation on the Streamable HTTP endpoint (a server MUST validate
 * `Origin`, against DNS rebinding). The default is same-origin, plus loopback
 * when the request itself targets a loopback host.
 */

class PingTool {
  ping = $tool({
    description: "Ping",
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "pong",
  });
}

class TestTransport extends StreamableHttpMcpTransport {
  public testIsOriginAllowed(origin: string, url: string): boolean {
    return this.isOriginAllowed(origin, new URL(url));
  }
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

const start = async (allowedOrigins?: string[]) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
  })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(PingTool);
  if (allowedOrigins) {
    alepha.set(mcpStreamableHttpOptions, {
      ...mcpStreamableHttpOptions.options.default,
      allowedOrigins,
    });
  }
  await alepha.start();
  const baseUrl = alepha.inject(ServerProvider).hostname;
  const post = (origin?: string) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin !== undefined ? { origin } : {}),
      },
      body: initBody,
    });
  return { alepha, baseUrl, post };
};

describe("StreamableHttpMcpTransport: Origin over HTTP", () => {
  it("serves a request with no Origin (server-to-server)", async () => {
    const { alepha, post } = await start();
    expect((await post()).status).toBe(200);
    await alepha.stop();
  });

  it("serves a request whose Origin is its own origin", async () => {
    const { alepha, baseUrl, post } = await start();
    expect((await post(new URL(baseUrl).origin)).status).toBe(200);
    await alepha.stop();
  });

  it("refuses a foreign Origin with 403 by default", async () => {
    const { alepha, post } = await start();
    const res = await post("https://evil.example");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Forbidden: Origin not allowed",
    });
    await alepha.stop();
  });

  it("refuses the opaque Origin null", async () => {
    const { alepha, post } = await start();
    expect((await post("null")).status).toBe(403);
    await alepha.stop();
  });

  it("serves a loopback Origin on another port when the request host is loopback", async () => {
    const { alepha, post } = await start();
    expect((await post("http://localhost:6274")).status).toBe(200);
    expect((await post("http://127.0.0.1:6274")).status).toBe(200);
    await alepha.stop();
  });

  it("serves any Origin with the explicit opt-out", async () => {
    const { alepha, post } = await start(["*"]);
    expect((await post("https://evil.example")).status).toBe(200);
    expect((await post("null")).status).toBe(200);
    await alepha.stop();
  });

  it("serves only the listed origins when a list is set", async () => {
    const { alepha, baseUrl, post } = await start(["https://app.example"]);
    expect((await post("https://app.example")).status).toBe(200);
    expect((await post("https://APP.example:443")).status).toBe(200);
    expect((await post("https://other.example")).status).toBe(403);
    // A list replaces the same-origin default rather than adding to it.
    expect((await post(new URL(baseUrl).origin)).status).toBe(403);
    await alepha.stop();
  });
});

describe("StreamableHttpMcpTransport: Origin rules", () => {
  const transport = () =>
    Alepha.create()
      .with(AlephaMcp)
      .with({ provide: StreamableHttpMcpTransport, use: TestTransport })
      .inject(TestTransport);

  it("compares the own origin after normalisation", () => {
    const t = transport();
    expect(
      t.testIsOriginAllowed(
        "HTTPS://Lore.Example:443",
        "https://lore.example/mcp",
      ),
    ).toBe(true);
    expect(
      t.testIsOriginAllowed(
        "https://lore.example:8443",
        "https://lore.example/mcp",
      ),
    ).toBe(false);
    expect(
      t.testIsOriginAllowed("http://lore.example", "https://lore.example/mcp"),
    ).toBe(false);
  });

  it("refuses a loopback Origin when the request host is public", () => {
    const t = transport();
    expect(
      t.testIsOriginAllowed(
        "http://localhost:3000",
        "https://lore.example/mcp",
      ),
    ).toBe(false);
  });

  it("refuses a public Origin when the request host is loopback", () => {
    const t = transport();
    expect(
      t.testIsOriginAllowed(
        "https://evil.example",
        "http://localhost:3000/mcp",
      ),
    ).toBe(false);
  });

  it("treats *.localhost, 127/8 and [::1] as loopback", () => {
    const t = transport();
    expect(
      t.testIsOriginAllowed(
        "http://app.localhost:5173",
        "http://[::1]:3000/mcp",
      ),
    ).toBe(true);
    expect(
      t.testIsOriginAllowed("http://[::1]:5173", "http://127.0.0.2:3000/mcp"),
    ).toBe(true);
  });

  it("refuses null and non-http origins", () => {
    const t = transport();
    expect(t.testIsOriginAllowed("null", "http://localhost:3000/mcp")).toBe(
      false,
    );
    expect(
      t.testIsOriginAllowed("file:///tmp/x.html", "http://localhost:3000/mcp"),
    ).toBe(false);
  });
});
