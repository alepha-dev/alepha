import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaMcp, MCP_PROTOCOL_VERSION } from "../index.ts";
import { $tool } from "../primitives/$tool.ts";
import {
  mcpStreamableHttpOptions,
  StreamableHttpMcpTransport,
} from "../transports/StreamableHttpMcpTransport.ts";

/**
 * HTTP-level coverage for the Streamable HTTP transport — in particular the
 * RFC 9728 `requireAuth` challenge that lets MCP clients discover an OAuth
 * authorization server.
 */

class PingTool {
  ping = $tool({
    description: "Ping",
    schema: { params: z.object({}), result: z.text() },
    handler: async () => "pong",
  });
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

describe("StreamableHttpMcpTransport — auth challenge", () => {
  it("dispatches unauthenticated requests when requireAuth is off (default)", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(PingTool);
    await alepha.start();

    const baseUrl = alepha.inject(ServerProvider).hostname;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initBody,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
    await alepha.stop();
  });

  it("rejects unauthenticated requests with a 401 + WWW-Authenticate challenge when requireAuth is on", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(PingTool);
    alepha.set(mcpStreamableHttpOptions, {
      ...mcpStreamableHttpOptions.options.default,
      requireAuth: true,
    });
    await alepha.start();

    const baseUrl = alepha.inject(ServerProvider).hostname;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initBody,
    });

    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain("resource_metadata=");
    // The advertised metadata URL must be absolute (Claude rejects relative).
    const match = challenge.match(/resource_metadata="([^"]+)"/);
    expect(match?.[1]).toMatch(
      /^https?:\/\/.+\/\.well-known\/oauth-protected-resource$/,
    );
    await alepha.stop();
  });

  it("honours a custom resourceMetadataPath", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(PingTool);
    alepha.set(mcpStreamableHttpOptions, {
      ...mcpStreamableHttpOptions.options.default,
      requireAuth: true,
      resourceMetadataPath: "/custom/resource-metadata",
    });
    await alepha.start();

    const baseUrl = alepha.inject(ServerProvider).hostname;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initBody,
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain(
      "/custom/resource-metadata",
    );
    await alepha.stop();
  });
});

describe("StreamableHttpMcpTransport — spec compliance", () => {
  const start = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(PingTool);
    alepha.inject(StreamableHttpMcpTransport);
    await alepha.start();
    return `${alepha.inject(ServerProvider).hostname}/mcp`;
  };

  it("should answer 202 to a notification, not 204", async () => {
    // Spec: a notification "MUST return HTTP 202 Accepted".
    const url = await start();

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    expect(res.status).toBe(202);
  });

  it("should use a null id for an unparseable message", async () => {
    // JSON-RPC requires `id: null` when the id cannot be determined.
    // Fabricating 0 both breaks the spec and can collide with a real id 0.
    //
    // Note the body is valid JSON but not a valid JSON-RPC message: malformed
    // JSON is rejected by the server's body parser before the transport ever
    // sees it, so this is the only route that reaches the parse-error branch.
    const url = await start();

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ not: "jsonrpc" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ id: null });
  });

  it("should accept any supported protocol version in the header", async () => {
    // The header used to be compared against a single negotiated value held
    // on the provider singleton — process-global, so another client (or a
    // fresh serverless isolate) could change what this client was checked
    // against and produce spurious 400s.
    const url = await start();

    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initBody,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

    expect(res.status).toBe(200);
  });
});
