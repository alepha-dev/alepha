import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $prompt,
  $resource,
  $resourceTemplate,
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The result envelope a modern (2026-07-28) request receives, over HTTP.
 *
 * Every result carries `resultType: "complete"` and the server's identity in
 * `_meta`; the six cacheable results also carry `ttlMs` and `cacheScope`.
 * Legacy results are untouched: `legacy-wire.spec.ts` pins them.
 */

const MODERN = "2026-07-28";
const SERVER_INFO = { name: "alepha-mcp", version: "1.0.0" };
const meta = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

class Server {
  add = $tool({
    description: "Add two numbers",
    schema: {
      params: z.object({ a: z.number(), b: z.number() }),
      result: z.object({ sum: z.number() }),
    },
    handler: async ({ params }) => ({ sum: params.a + params.b }),
  });

  raw = $tool({
    description: "Returns raw content with its own _meta",
    handler: async () => ({
      content: [{ type: "text", text: "raw" }],
      _meta: { "com.example/trace": "t-1" },
    }),
  });

  readme = $resource({
    uri: "docs://readme",
    handler: async () => ({ text: "# Hello" }),
  });

  pinned = $resource({
    uri: "docs://pinned",
    cache: { ttlMs: 60_000, cacheScope: "public" },
    handler: async () => ({ text: "the same for everyone" }),
  });

  folio = $resourceTemplate({
    uriTemplate: "folio://{id}",
    variables: z.object({ id: z.text() }),
    handler: async ({ variables }) => ({ text: `folio ${variables.id}` }),
  });

  release = $resourceTemplate({
    uriTemplate: "release://{tag}",
    variables: z.object({ tag: z.text() }),
    cache: { ttlMs: 3_600_000 },
    handler: async ({ variables }) => ({ text: `release ${variables.tag}` }),
  });

  greet = $prompt({
    description: "Greet someone",
    args: z.object({ who: z.text() }),
    handler: async ({ args }) => [
      { role: "user", content: `Say hello to ${args.who}` },
    ],
    complete: async () => ["Ada", "Alan"],
  });
}

const start = async (configure?: (mcp: McpServerProvider) => void) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Server);
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  mcp.protocolVersions = [
    ...MODERN_PROTOCOL_VERSIONS,
    ...LEGACY_PROTOCOL_VERSIONS,
  ];
  configure?.(mcp);
  const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

  /**
   * One modern request, with the headers a modern client mirrors from its
   * body.
   */
  const modern = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<{ status: number; body: any }> => {
    const name = params.name ?? params.uri;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MODERN,
        "mcp-method": method,
        ...(typeof name === "string" ? { "mcp-name": name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { ...params, _meta: meta },
      }),
    });
    return { status: res.status, body: await res.json() };
  };

  return { alepha, modern };
};

const envelope = {
  resultType: "complete",
  _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
};
const listCache = { ttlMs: 300_000, cacheScope: "public" };
const readCache = { ttlMs: 0, cacheScope: "private" };

// ---------------------------------------------------------------------------------------------------------------------

describe("Modern MCP results", () => {
  describe("cacheable results", () => {
    it("server/discover", async () => {
      const { alepha, modern } = await start();

      const { status, body } = await modern("server/discover");

      expect(status).toBe(200);
      expect(body.result).toEqual({
        supportedVersions: [MODERN, ...LEGACY_PROTOCOL_VERSIONS],
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          completions: {},
        },
        ...envelope,
        ...listCache,
      });
      await alepha.stop();
    });

    it("tools/list", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("tools/list");

      expect(body.result).toMatchObject({ ...envelope, ...listCache });
      expect(body.result.tools.map((t: any) => t.name)).toEqual(["add", "raw"]);
      await alepha.stop();
    });

    it("prompts/list", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("prompts/list");

      expect(body.result).toMatchObject({ ...envelope, ...listCache });
      expect(body.result.prompts).toHaveLength(1);
      await alepha.stop();
    });

    it("resources/list", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/list");

      expect(body.result).toMatchObject({ ...envelope, ...listCache });
      expect(body.result.resources).toHaveLength(2);
      await alepha.stop();
    });

    it("resources/templates/list", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/templates/list");

      expect(body.result).toMatchObject({ ...envelope, ...listCache });
      expect(body.result.resourceTemplates).toHaveLength(2);
      await alepha.stop();
    });

    it("resources/read of a resource: 0 and private by default", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/read", { uri: "docs://readme" });

      expect(body.result).toEqual({
        contents: [
          { uri: "docs://readme", mimeType: "text/plain", text: "# Hello" },
        ],
        ...envelope,
        ...readCache,
      });
      await alepha.stop();
    });

    it("resources/read served by a template: 0 and private by default", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/read", { uri: "folio://7" });

      expect(body.result).toMatchObject({ ...envelope, ...readCache });
      expect(body.result.contents[0].text).toBe("folio 7");
      await alepha.stop();
    });

    it("every page of a paginated tools/list carries the same hints", async () => {
      const { alepha, modern } = await start((mcp) => {
        mcp.pageSize = 1;
      });

      const first = await modern("tools/list");
      const second = await modern("tools/list", {
        cursor: first.body.result.nextCursor,
      });

      expect(first.body.result.nextCursor).toBeDefined();
      expect(second.body.result.nextCursor).toBeUndefined();
      for (const page of [first, second]) {
        expect(page.body.result).toMatchObject({ ...envelope, ...listCache });
        expect(page.body.result.tools).toHaveLength(1);
      }
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("overrides", () => {
    it("listCache and discoverCache on the provider", async () => {
      const { alepha, modern } = await start((mcp) => {
        mcp.listCache = { ttlMs: 10_000, cacheScope: "private" };
        mcp.discoverCache = { ttlMs: 86_400_000, cacheScope: "public" };
      });

      expect((await modern("tools/list")).body.result).toMatchObject({
        ttlMs: 10_000,
        cacheScope: "private",
      });
      expect(
        (await modern("resources/templates/list")).body.result,
      ).toMatchObject({ ttlMs: 10_000, cacheScope: "private" });
      expect((await modern("server/discover")).body.result).toMatchObject({
        ttlMs: 86_400_000,
        cacheScope: "public",
      });
      await alepha.stop();
    });

    it("cache on $resource", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/read", { uri: "docs://pinned" });

      expect(body.result).toMatchObject({
        ttlMs: 60_000,
        cacheScope: "public",
      });
      await alepha.stop();
    });

    it("cache on $resourceTemplate, the unset scope staying private", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("resources/read", { uri: "release://1.0" });

      expect(body.result).toMatchObject({
        ttlMs: 3_600_000,
        cacheScope: "private",
      });
      await alepha.stop();
    });

    it("a negative or fractional ttlMs goes out as a valid integer, and a bad scope as private", async () => {
      const { alepha, modern } = await start((mcp) => {
        mcp.listCache = { ttlMs: -5, cacheScope: "shared" as any };
        mcp.discoverCache = { ttlMs: 1500.7, cacheScope: "public" };
      });

      expect((await modern("tools/list")).body.result).toMatchObject({
        ttlMs: 0,
        cacheScope: "private",
      });
      expect((await modern("server/discover")).body.result).toMatchObject({
        ttlMs: 1500,
      });
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("results that are not cacheable", () => {
    it("tools/call, success", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("tools/call", {
        name: "add",
        arguments: { a: 2, b: 3 },
      });

      expect(body.result).toEqual({
        content: [{ type: "text", text: '{"sum":5}' }],
        structuredContent: { sum: 5 },
        ...envelope,
      });
      await alepha.stop();
    });

    it("tools/call, isError: still a result, so it carries resultType", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("tools/call", {
        name: "add",
        arguments: { a: "two", b: 3 },
      });

      expect(body.result).toMatchObject({ isError: true, ...envelope });
      expect(body.result.ttlMs).toBeUndefined();
      await alepha.stop();
    });

    it("tools/call returning raw content: serverInfo merged into the tool's own _meta", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("tools/call", { name: "raw" });

      expect(body.result).toEqual({
        content: [{ type: "text", text: "raw" }],
        resultType: "complete",
        _meta: {
          "com.example/trace": "t-1",
          "io.modelcontextprotocol/serverInfo": SERVER_INFO,
        },
      });
      await alepha.stop();
    });

    it("prompts/get", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("prompts/get", {
        name: "greet",
        arguments: { who: "Ada" },
      });

      expect(body.result).toEqual({
        description: "Greet someone",
        messages: [
          { role: "user", content: { type: "text", text: "Say hello to Ada" } },
        ],
        ...envelope,
      });
      await alepha.stop();
    });

    it("completion/complete", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("completion/complete", {
        ref: { type: "ref/prompt", name: "greet" },
        argument: { name: "who", value: "A" },
      });

      expect(body.result).toEqual({
        completion: { values: ["Ada", "Alan"], total: 2, hasMore: false },
        ...envelope,
      });
      await alepha.stop();
    });

    it("a JSON-RPC error carries no resultType", async () => {
      const { alepha, modern } = await start();

      const { body } = await modern("tools/call", { name: "nope" });

      expect(body.result).toBeUndefined();
      expect(body.error).toEqual({
        code: -32602,
        message: "Unknown tool: nope",
      });
      expect(body.resultType).toBeUndefined();
      await alepha.stop();
    });
  });
});
