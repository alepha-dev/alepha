import { Alepha, t } from "alepha";
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
    schema: { params: t.object({}), result: t.text() },
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
