import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $prompt,
  $resource,
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MCP 2026-07-28 mirrors body fields into HTTP headers so an intermediary can
 * route without parsing the body, and the server MUST refuse a request whose
 * headers are missing or say something the body does not (Streamable HTTP,
 * "Server Validation"). Strict on modern requests, never applied to legacy
 * ones.
 */

const MODERN = "2026-07-28";

const meta = (version: unknown = MODERN) => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
});

/**
 * Base64 of the UTF-8 bytes, in the `=?base64?...?=` sentinel.
 */
const sentinel = (value: string) =>
  `=?base64?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;

class Server {
  ping = $tool({
    description: "Ping",
    schema: { result: z.text() },
    handler: async () => "pong",
  });

  weather = $tool({
    name: "météo",
    description: "A tool whose name is not header-safe",
    schema: { result: z.text() },
    handler: async () => "sunny",
  });

  readme = $resource({
    uri: "docs://readme",
    handler: async () => ({ text: "# Hello" }),
  });

  greet = $prompt({
    description: "Greet",
    handler: async () => [{ role: "user", content: "hello" }],
  });
}

const start = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Server);
  await alepha.start();
  alepha.inject(McpServerProvider).protocolVersions = [
    ...MODERN_PROTOCOL_VERSIONS,
    ...LEGACY_PROTOCOL_VERSIONS,
  ];
  const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

  const post = async (
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: text ? JSON.parse(text) : undefined,
    };
  };

  return { alepha, url, post };
};

const expectHeaderMismatch = (res: { status: number; body: any }) => {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe(-32020);
  expect(res.body.result).toBeUndefined();
};

// ---------------------------------------------------------------------------------------------------------------------

describe("Modern MCP request headers", () => {
  describe("required headers", () => {
    it("a modern request with no MCP-Protocol-Version is 400 and -32020", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/list", params: { _meta: meta() } },
        { "mcp-method": "tools/list" },
      );

      expectHeaderMismatch(res);
      expect(res.body.error.message).toContain("MCP-Protocol-Version");
      await alepha.stop();
    });

    it("a modern request with no Mcp-Method is 400 and -32020", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/list", params: { _meta: meta() } },
        { "mcp-protocol-version": MODERN },
      );

      expectHeaderMismatch(res);
      expect(res.body.error.message).toContain("Mcp-Method");
      await alepha.stop();
    });

    it("tools/call, resources/read and prompts/get with no Mcp-Name are 400 and -32020", async () => {
      const { alepha, post } = await start();

      for (const [method, params] of [
        ["tools/call", { name: "ping", arguments: {} }],
        ["resources/read", { uri: "docs://readme" }],
        ["prompts/get", { name: "greet" }],
      ] as const) {
        const res = await post(
          { method, params: { ...params, _meta: meta() } },
          { "mcp-protocol-version": MODERN, "mcp-method": method },
        );

        expectHeaderMismatch(res);
        expect(res.body.error.message).toContain("Mcp-Name");
      }
      await alepha.stop();
    });

    it("header names are matched case-insensitively", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/call",
          params: { name: "ping", arguments: {}, _meta: meta() },
        },
        {
          "MCP-Protocol-Version": MODERN,
          "MCP-METHOD": "tools/call",
          "mcp-NAME": "ping",
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toBe("pong");
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("headers that disagree with the body", () => {
    it("Mcp-Method", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/list", params: { _meta: meta() } },
        { "mcp-protocol-version": MODERN, "mcp-method": "prompts/list" },
      );

      expectHeaderMismatch(res);
      await alepha.stop();
    });

    it("Mcp-Method compares values case-sensitively", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/list", params: { _meta: meta() } },
        { "mcp-protocol-version": MODERN, "mcp-method": "TOOLS/LIST" },
      );

      expectHeaderMismatch(res);
      await alepha.stop();
    });

    it("Mcp-Name against params.name", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/call",
          params: { name: "ping", arguments: {}, _meta: meta() },
        },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/call",
          "mcp-name": "delete_everything",
        },
      );

      expectHeaderMismatch(res);
      expect(res.body.error.message).toBe(
        "Header mismatch: Mcp-Name header value 'delete_everything' does not match body value 'ping'",
      );
      await alepha.stop();
    });

    it("Mcp-Name against params.uri", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "resources/read",
          params: { uri: "docs://readme", _meta: meta() },
        },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "resources/read",
          "mcp-name": "docs://secrets",
        },
      );

      expectHeaderMismatch(res);
      await alepha.stop();
    });

    it("MCP-Protocol-Version against _meta, and _meta carrying none", async () => {
      const { alepha, post } = await start();

      for (const params of [
        { _meta: meta("2025-11-25") },
        { _meta: { "io.modelcontextprotocol/clientCapabilities": {} } },
        {},
      ]) {
        const res = await post(
          { method: "tools/list", params },
          { "mcp-protocol-version": MODERN, "mcp-method": "tools/list" },
        );

        expectHeaderMismatch(res);
      }
      await alepha.stop();
    });

    it("a disagreement is -32020 before an unsupported version is -32022", async () => {
      const { alepha, post } = await start();

      const mismatch = await post(
        { method: "tools/list", params: { _meta: meta(MODERN) } },
        { "mcp-protocol-version": "2027-01-01", "mcp-method": "tools/list" },
      );
      expectHeaderMismatch(mismatch);

      const unsupported = await post(
        { method: "tools/list", params: { _meta: meta("2027-01-01") } },
        { "mcp-protocol-version": "2027-01-01", "mcp-method": "tools/list" },
      );
      expect(unsupported.status).toBe(400);
      expect(unsupported.body.error.code).toBe(-32022);
      await alepha.stop();
    });

    it("never runs the handler of a rejected request", async () => {
      let calls = 0;

      class Counter {
        count = $tool({
          description: "Count",
          schema: { result: z.text() },
          handler: async () => {
            calls++;
            return "counted";
          },
        });
      }

      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      })
        .with(AlephaMcp)
        .with(StreamableHttpMcpTransport)
        .with(Counter);
      await alepha.start();
      alepha.inject(McpServerProvider).protocolVersions = [
        ...MODERN_PROTOCOL_VERSIONS,
        ...LEGACY_PROTOCOL_VERSIONS,
      ];

      const res = await fetch(`${alepha.inject(ServerProvider).hostname}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/list",
          "mcp-name": "count",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "count", arguments: {}, _meta: meta() },
        }),
      });

      expect(res.status).toBe(400);
      expect(calls).toBe(0);
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("Base64 sentinel", () => {
    it("a non-ASCII tool name travels encoded and is decoded before comparison", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/call",
          params: { name: "météo", arguments: {}, _meta: meta() },
        },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/call",
          "mcp-name": sentinel("météo"),
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toBe("sunny");
      await alepha.stop();
    });

    it("a sentinel that decodes to another name is a mismatch", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/call",
          params: { name: "météo", arguments: {}, _meta: meta() },
        },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/call",
          "mcp-name": sentinel("meteo"),
        },
      );

      expectHeaderMismatch(res);
      await alepha.stop();
    });

    it("a sentinel that is not valid Base64 or not UTF-8 is malformed", async () => {
      const { alepha, post } = await start();

      for (const value of ["=?base64?not base64!?=", "=?base64?/w==?="]) {
        const res = await post(
          {
            method: "tools/call",
            params: { name: "ping", arguments: {}, _meta: meta() },
          },
          {
            "mcp-protocol-version": MODERN,
            "mcp-method": "tools/call",
            "mcp-name": value,
          },
        );

        expectHeaderMismatch(res);
        expect(res.body.error.message).toContain("malformed");
      }
      await alepha.stop();
    });

    it("the markers are case-sensitive: an uppercase one is a plain value", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/call",
          params: { name: "ping", arguments: {}, _meta: meta() },
        },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/call",
          "mcp-name": "=?BASE64?cGluZw==?=",
        },
      );

      expectHeaderMismatch(res);
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("unknown methods", () => {
    it("a modern request for an unknown method is HTTP 404 and -32601", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "subscriptions/listen", params: { _meta: meta() } },
        {
          "mcp-protocol-version": MODERN,
          "mcp-method": "subscriptions/listen",
        },
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(-32601);
      await alepha.stop();
    });

    it("is decided before a progress stream opens", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          method: "tools/nope",
          params: { _meta: { ...meta(), progressToken: "p-1" } },
        },
        { "mcp-protocol-version": MODERN, "mcp-method": "tools/nope" },
      );

      expect(res.status).toBe(404);
      expect(res.contentType).toContain("application/json");
      expect(res.body.error.code).toBe(-32601);
      await alepha.stop();
    });

    it("ping is gone from the modern protocol: 404; legacy ping still answers 200", async () => {
      const { alepha, post } = await start();

      const modern = await post(
        { method: "ping", params: { _meta: meta() } },
        { "mcp-protocol-version": MODERN, "mcp-method": "ping" },
      );
      expect(modern.status).toBe(404);
      expect(modern.body.error.code).toBe(-32601);

      const legacy = await post(
        { method: "ping" },
        { "mcp-protocol-version": "2025-11-25" },
      );
      expect(legacy.status).toBe(200);
      expect(legacy.body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
      await alepha.stop();
    });

    it("a legacy request for an unknown method keeps HTTP 200", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/nope" },
        { "mcp-protocol-version": "2025-11-25" },
      );

      expect(res.status).toBe(200);
      expect(res.body.error.code).toBe(-32601);
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("legacy requests are never validated", () => {
    it("a 2025-11-25 request without Mcp-Method or Mcp-Name is served", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/call", params: { name: "ping", arguments: {} } },
        { "mcp-protocol-version": "2025-11-25" },
      );

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toBe("pong");
      await alepha.stop();
    });

    it("a 2025-11-25 request whose Mcp-* headers disagree with its body is served", async () => {
      const { alepha, post } = await start();

      const res = await post(
        { method: "tools/call", params: { name: "ping", arguments: {} } },
        {
          "mcp-protocol-version": "2025-11-25",
          "mcp-method": "prompts/get",
          "mcp-name": "something-else",
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toBe("pong");
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("methods other than POST", () => {
    it("DELETE /mcp answers 405 with Allow: POST, like GET", async () => {
      const { alepha, url } = await start();

      for (const method of ["DELETE", "GET"]) {
        const res = await fetch(url, { method });

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
      }
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * claude.ai's opening probe, replayed. No real probe body has been read yet
   * (#Q2301 could not capture one), so this is built from what is known for
   * certain: the headers measured on Lore between 2026-09-06 and 2026-09-13
   * (`Mcp-Method: server/discover`, `MCP-Protocol-Version: 2026-07-28`,
   * `User-Agent: Claude-User`, both content types accepted) and the `_meta`
   * the spec's own `server/discover` example carries.
   */
  describe("claude.ai probe replay", () => {
    it("passes validation and gets a server/discover result", async () => {
      const { alepha, post } = await start();

      const res = await post(
        {
          id: 0,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": MODERN,
              "io.modelcontextprotocol/clientInfo": {
                name: "claude-ai",
                version: "0.1.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
        {
          "User-Agent": "Claude-User",
          Accept: "application/json, text/event-stream",
          "Mcp-Method": "server/discover",
          "MCP-Protocol-Version": MODERN,
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({
        resultType: "complete",
        supportedVersions: [MODERN, ...LEGACY_PROTOCOL_VERSIONS],
        ttlMs: 300_000,
        cacheScope: "public",
      });
      await alepha.stop();
    });
  });
});
