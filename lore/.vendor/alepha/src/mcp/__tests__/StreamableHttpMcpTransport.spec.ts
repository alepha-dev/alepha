import { Alepha, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_LEGACY_PROTOCOL_VERSION,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
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
    protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * claude.ai opens every connection with a 2026-07-28 `server/discover` probe.
 * What it does next depends only on the answer:
 *
 * - a `DiscoverResult`, or a recognized modern JSON-RPC error such as
 *   `-32022`: the server is modern, and the client stays modern;
 * - a 400 whose body is NOT a recognized modern JSON-RPC error: the server is
 *   legacy, and the client falls back to `initialize` (the 2026-07-28
 *   Streamable HTTP backward-compatibility rule).
 *
 * Since epic #E57 the server serves 2026-07-28 by default, so the probe gets
 * the first answer. The second survives for a server whose `protocolVersions`
 * holds no modern version, and its body must stay a plain one: a JSON-RPC
 * error there would tell the client the server is modern when it is not.
 */
describe("StreamableHttpMcpTransport: a modern probe", () => {
  const probeHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-method": "server/discover",
    "mcp-protocol-version": "2026-07-28",
  };

  const probeBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "claude-ai",
          version: "0.1.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });

  /**
   * `legacyOnly` removes the modern versions from `protocolVersions`: the
   * configuration in which the plain fallback 400 is still the answer.
   */
  const start = async (legacyOnly = false) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "info", SERVER_PORT: 0 },
    })
      .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(PingTool);
    await alepha.start();
    if (legacyOnly) {
      alepha.inject(McpServerProvider).protocolVersions = [
        ...LEGACY_PROTOCOL_VERSIONS,
      ];
    }
    return {
      alepha,
      url: `${alepha.inject(ServerProvider).hostname}/mcp`,
      logs: alepha.inject(MemoryDestinationProvider),
    };
  };

  it("serves the probe by default: 200 and a server/discover result", async () => {
    const { alepha, url } = await start();

    const res = await fetch(url, {
      method: "POST",
      headers: probeHeaders,
      body: probeBody,
    });
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [
        ...MODERN_PROTOCOL_VERSIONS,
        ...LEGACY_PROTOCOL_VERSIONS,
      ],
    });
    await alepha.stop();
  });

  it("answers a probe for an unknown version with 400 and -32022 listing 2026-07-28, so the client retries instead of falling back", async () => {
    const { alepha, url } = await start();

    const res = await fetch(url, {
      method: "POST",
      headers: { ...probeHeaders, "mcp-protocol-version": "2027-01-01" },
      body: probeBody.replaceAll("2026-07-28", "2027-01-01"),
    });
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toContain("2026-07-28");
    expect(body.error.data.requested).toBe("2027-01-01");
    await alepha.stop();
  });

  it("answers the probe with HTTP 400 when modern versions are removed from protocolVersions", async () => {
    const { alepha, url } = await start(true);

    const res = await fetch(url, {
      method: "POST",
      headers: probeHeaders,
      body: probeBody,
    });

    expect(res.status).toBe(400);
    await alepha.stop();
  });

  it("answers with a body that is not a JSON-RPC error, so the client falls back", async () => {
    const { alepha, url } = await start(true);

    const res = await fetch(url, {
      method: "POST",
      headers: probeHeaders,
      body: probeBody,
    });
    const body = (await res.json()) as Record<string, unknown>;

    // A modern client reads `jsonrpc` + `error.code` as "this server is
    // modern" and retries instead of falling back to `initialize`.
    expect(body.jsonrpc).toBeUndefined();
    expect(typeof body.error).toBe("string");
    expect((body.error as any)?.code).toBeUndefined();
    await alepha.stop();
  });

  it("logs the rejection at INFO with the probe's shape, not at WARN", async () => {
    const { alepha, url, logs } = await start(true);

    await fetch(url, {
      method: "POST",
      headers: probeHeaders,
      body: probeBody,
    });

    const message = "MCP-Protocol-Version header not supported";
    expect(logs.wasLogged(message, "WARN")).toBe(false);
    const entry = logs.logs.find((it) => it.message === message);
    expect(entry?.level).toBe("INFO");
    expect(entry?.data).toMatchObject({
      header: "2026-07-28",
      method: "server/discover",
      mcpMethod: "server/discover",
      metaKeys: [
        "io.modelcontextprotocol/protocolVersion",
        "io.modelcontextprotocol/clientInfo",
        "io.modelcontextprotocol/clientCapabilities",
      ],
      metaProtocolVersion: "2026-07-28",
      metaClientInfo: { name: "claude-ai", version: "0.1.0" },
    });
    await alepha.stop();
  });

  it("never logs a rejected request's arguments", async () => {
    const { alepha, url, logs } = await start(true);

    await fetch(url, {
      method: "POST",
      headers: {
        ...probeHeaders,
        "mcp-method": "tools/call",
        "mcp-name": "ping",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "ping",
          arguments: { secret: "hunter2" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "com.example/session": "private-value",
          },
        },
      }),
    });

    const entry = logs.logs.find(
      (it) => it.message === "MCP-Protocol-Version header not supported",
    );
    expect(entry?.data).toMatchObject({
      method: "tools/call",
      mcpName: "ping",
      metaKeys: [
        "io.modelcontextprotocol/protocolVersion",
        "com.example/session",
      ],
    });
    const serialized = JSON.stringify(logs.logs.map((it) => it.data));
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("private-value");
    await alepha.stop();
  });
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `McpContext.data` is documented as the place a transport passes the
 * authenticated user through. Nothing populated it: the transport built
 * `{ headers }` and there was no hook. Four unit tests "covered" it by calling
 * `primitive.execute(args, { data })` directly, which bypasses every transport
 * and so proved nothing about the production path. These go over HTTP.
 */
describe("StreamableHttpMcpTransport — context", () => {
  let seen: unknown;

  class WhoAmITool {
    whoami = $tool({
      description: "Report the context data",
      schema: { result: z.text() },
      handler: async ({ context }) => {
        seen = context?.data;
        return JSON.stringify(context?.data ?? null);
      },
    });
  }

  const callWhoAmI = async (alepha: Alepha) => {
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      }),
    });
    return res.json() as any;
  };

  it("passes headers through to the handler over HTTP", async () => {
    seen = undefined;
    let headers: Record<string, unknown> | undefined;

    class HeaderTool {
      peek = $tool({
        description: "Report a header",
        schema: { result: z.text() },
        handler: async ({ context }) => {
          headers = context?.headers;
          return "ok";
        },
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(HeaderTool);
    await alepha.start();

    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "peek", arguments: {} },
      }),
    });

    expect(headers?.["x-tenant"]).toBe("acme");
    await alepha.stop();
  });

  it("leaves data undefined when no user is authenticated", async () => {
    seen = "sentinel";

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(WhoAmITool);
    await alepha.start();

    await callWhoAmI(alepha);

    expect(seen).toBeUndefined();
    await alepha.stop();
  });

  it("lets a subclass populate data, and the handler receives it", async () => {
    seen = undefined;

    class TenantTransport extends StreamableHttpMcpTransport {
      protected buildContext(request: {
        headers: Record<string, any>;
        user?: unknown;
      }) {
        return {
          ...super.buildContext(request),
          data: { tenant: request.headers["x-tenant"] },
        };
      }
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with({ provide: StreamableHttpMcpTransport, use: TenantTransport })
      .with(WhoAmITool);
    await alepha.start();

    const body = await callWhoAmI(alepha);

    expect(seen).toEqual({ tenant: "acme" });
    expect(body.result.content[0].text).toBe('{"tenant":"acme"}');
    await alepha.stop();
  });
});
