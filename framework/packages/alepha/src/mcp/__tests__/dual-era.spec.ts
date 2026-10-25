import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  type McpContext,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One server, both eras (epic #E57).
 *
 * A request is modern iff its `_meta` protocol version or its
 * `MCP-Protocol-Version` header names a version outside the legacy list;
 * everything else, and `initialize` always, is legacy. The modern path is on
 * exactly when `McpServerProvider.protocolVersions` holds a modern version,
 * so every spec here says which state it runs in, by assignment, rather than
 * relying on a default that the flip to 2026-07-28 changes.
 */

const MODERN = "2026-07-28";

const dualEra = (): string[] => [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
];
const legacyOnly = (): string[] => [...LEGACY_PROTOCOL_VERSIONS];

const modernMeta = (version = MODERN, extra: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
  ...extra,
});

let seen: McpContext | undefined;

/**
 * A call, so the compiler does not narrow `seen` to `undefined` for the rest
 * of the block the way a bare assignment would.
 */
const forget = () => {
  seen = undefined;
};

class Tools {
  whoami = $tool({
    description: "Report the context",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      seen = context;
      return "ok";
    },
  });
}

const provider = async (versions: string[]) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaMcp)
    .with(Tools);
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  mcp.protocolVersions = versions;
  seen = undefined;
  return { alepha, mcp };
};

const http = async (versions: string[]) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Tools);
  await alepha.start();
  alepha.inject(McpServerProvider).protocolVersions = versions;
  seen = undefined;
  const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

  const post = async (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: text ? JSON.parse(text) : undefined,
    };
  };

  return { alepha, post };
};

/**
 * The headers a modern client mirrors from its body.
 */
const modernHeaders = (
  method: string,
  name?: string,
  version = MODERN,
): Record<string, string> => ({
  "mcp-protocol-version": version,
  "mcp-method": method,
  ...(name ? { "mcp-name": name } : {}),
});

// ---------------------------------------------------------------------------------------------------------------------

describe("Dual-era MCP", () => {
  describe("the gate", () => {
    it("is seeded from SUPPORTED_PROTOCOL_VERSIONS", async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
        AlephaMcp,
      );
      await alepha.start();

      const mcp = alepha.inject(McpServerProvider);
      expect(mcp.protocolVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
      await alepha.stop();
    });

    it("is on exactly when protocolVersions holds a modern version", async () => {
      const { alepha, mcp } = await provider(legacyOnly());
      expect(mcp.isModernEnabled()).toBe(false);

      mcp.protocolVersions = dualEra();
      expect(mcp.isModernEnabled()).toBe(true);

      mcp.protocolVersions = ["2027-01-01"];
      expect(mcp.isModernEnabled()).toBe(true);
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("the era rule", () => {
    const callWhoami = (mcp: McpServerProvider, params: object, ctx = {}) =>
      mcp.handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "whoami", arguments: {}, ...params },
        },
        ctx,
      );

    it("a request whose _meta names a modern version is modern, and its _meta reaches the handler", async () => {
      const { alepha, mcp } = await provider(dualEra());

      const res = await callWhoami(mcp, { _meta: modernMeta() });

      expect(res?.error).toBeUndefined();
      expect(seen?.protocolVersion).toBe(MODERN);
      expect(seen?.clientInfo).toEqual({ name: "modern", version: "2.0.0" });
      expect(seen?.clientCapabilities).toEqual({});
      await alepha.stop();
    });

    it("a request whose only modern version is the header is modern", async () => {
      const { alepha, mcp } = await provider(dualEra());

      await callWhoami(
        mcp,
        {},
        { headers: { "mcp-protocol-version": MODERN } },
      );

      expect(seen?.protocolVersion).toBe(MODERN);
      await alepha.stop();
    });

    it("reads absent clientCapabilities as {}, never as a missing request", async () => {
      const { alepha, mcp } = await provider(dualEra());

      const res = await callWhoami(mcp, {
        _meta: { "io.modelcontextprotocol/protocolVersion": MODERN },
      });

      expect(res?.error).toBeUndefined();
      expect(seen?.clientCapabilities).toEqual({});
      expect(seen?.clientInfo).toBeUndefined();
      await alepha.stop();
    });

    it("a request naming a legacy version, or none, is legacy: no modern context", async () => {
      const { alepha, mcp } = await provider(dualEra());

      for (const params of [
        {},
        { _meta: modernMeta("2025-11-25") },
        { _meta: { progressToken: 7 } },
      ]) {
        forget();
        await callWhoami(mcp, params, {
          headers: { "mcp-protocol-version": "2025-11-25" },
        });
        expect(seen).toBeDefined();
        expect(seen?.protocolVersion).toBeUndefined();
        expect(seen?.clientInfo).toBeUndefined();
        expect(seen?.clientCapabilities).toBeUndefined();
      }
      await alepha.stop();
    });

    it("overwrites modern fields a caller put in the context of a legacy request", async () => {
      const { alepha, mcp } = await provider(dualEra());

      await callWhoami(mcp, {}, { protocolVersion: MODERN });

      expect(seen?.protocolVersion).toBeUndefined();
      await alepha.stop();
    });

    it("ignores modern _meta while the modern path is off", async () => {
      const { alepha, mcp } = await provider(legacyOnly());

      const res = await callWhoami(mcp, { _meta: modernMeta() });

      expect(res?.error).toBeUndefined();
      expect(seen?.protocolVersion).toBeUndefined();
      await alepha.stop();
    });

    it("initialize is always legacy and negotiates from the legacy list only", async () => {
      const { alepha, mcp } = await provider(dualEra());

      const negotiate = async (protocolVersion: string) => {
        const res = await mcp.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: "legacy", version: "1.0.0" },
            _meta: modernMeta(),
          },
        });
        return (res?.result as { protocolVersion?: string } | undefined)
          ?.protocolVersion;
      };

      expect(await negotiate("2025-06-18")).toBe("2025-06-18");
      expect(await negotiate(MODERN)).toBe("2025-11-25");
      expect(await negotiate("2099-01-01")).toBe("2025-11-25");
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("server/discover", () => {
    const discover = (mcp: McpServerProvider, meta?: object) =>
      mcp.handleMessage({
        jsonrpc: "2.0",
        id: "d",
        method: "server/discover",
        params: meta ? { _meta: meta } : {},
      });

    it("answers a modern request with the supported versions, modern first, and the capabilities", async () => {
      // Assigned legacy-first on purpose: discover orders by era itself.
      const { alepha, mcp } = await provider([
        ...LEGACY_PROTOCOL_VERSIONS,
        ...MODERN_PROTOCOL_VERSIONS,
      ]);

      const res = await discover(mcp, modernMeta());

      expect(res?.result).toMatchObject({
        supportedVersions: [MODERN, ...LEGACY_PROTOCOL_VERSIONS],
        capabilities: mcp.getCapabilities(),
      });
      expect(res?.result).toMatchObject({ capabilities: { tools: {} } });
      await alepha.stop();
    });

    it("is -32601 on a legacy request", async () => {
      const { alepha, mcp } = await provider(dualEra());

      const res = await discover(mcp);

      expect(res?.error?.code).toBe(-32601);
      await alepha.stop();
    });

    it("is -32601 while the modern path is off, whatever the request carries", async () => {
      const { alepha, mcp } = await provider(legacyOnly());

      const res = await discover(mcp, modernMeta());

      expect(res?.error?.code).toBe(-32601);
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("an unsupported version", () => {
    it("modern path on: HTTP 400 and -32022 listing what is supported", async () => {
      const { alepha, post } = await http(dualEra());

      const res = await post(
        {
          id: 1,
          method: "server/discover",
          params: { _meta: modernMeta("2027-01-01") },
        },
        modernHeaders("server/discover", undefined, "2027-01-01"),
      );

      expect(res.status).toBe(400);
      expect(res.contentType).toContain("application/json");
      expect(res.body).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: {
            supported: [MODERN, ...LEGACY_PROTOCOL_VERSIONS],
            requested: "2027-01-01",
          },
        },
      });
      await alepha.stop();
    });

    it("modern path on: a request that asked for a progress stream still gets the 400, not a stream", async () => {
      const { alepha, post } = await http(dualEra());

      const res = await post(
        {
          id: 2,
          method: "tools/call",
          params: {
            name: "whoami",
            arguments: {},
            _meta: modernMeta("2027-01-01", { progressToken: "p" }),
          },
        },
        modernHeaders("tools/call", "whoami", "2027-01-01"),
      );

      expect(res.status).toBe(400);
      expect(res.contentType).toContain("application/json");
      expect(res.body.error.code).toBe(-32022);
      expect(seen).toBeUndefined();
      await alepha.stop();
    });

    it("modern path on: the same answer over stdio-like direct calls, with no header at all", async () => {
      const { alepha, mcp } = await provider(dualEra());

      const res = await mcp.handleMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "whoami",
          arguments: {},
          _meta: modernMeta("2027-01-01"),
        },
      });

      expect(res?.error).toEqual({
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          supported: [MODERN, ...LEGACY_PROTOCOL_VERSIONS],
          requested: "2027-01-01",
        },
      });
      expect(seen).toBeUndefined();
      await alepha.stop();
    });

    it("modern path off: the plain non-JSON-RPC 400 for every version, so a dual-era client falls back", async () => {
      const { alepha, post } = await http(legacyOnly());

      for (const version of [MODERN, "2027-01-01", "1999-01-01"]) {
        const res = await post(
          {
            id: 1,
            method: "server/discover",
            params: { _meta: modernMeta(version) },
          },
          modernHeaders("server/discover", undefined, version),
        );

        expect(res.status).toBe(400);
        expect(res.body.jsonrpc).toBeUndefined();
        expect(typeof res.body.error).toBe("string");
      }
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------

  describe("both eras on one HTTP endpoint", () => {
    it("serves a modern tools/call with no initialize next to a legacy initialize then tools/call", async () => {
      const { alepha, post } = await http(dualEra());

      const modern = await post(
        {
          id: 1,
          method: "tools/call",
          params: { name: "whoami", arguments: {}, _meta: modernMeta() },
        },
        modernHeaders("tools/call", "whoami"),
      );
      expect(modern.status).toBe(200);
      expect(modern.body.result.content[0].text).toBe("ok");
      expect(seen?.protocolVersion).toBe(MODERN);

      const init = await post({
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      expect(init.status).toBe(200);
      expect(init.body.result.protocolVersion).toBe("2025-11-25");

      const legacy = await post(
        {
          id: 3,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        },
        { "mcp-protocol-version": "2025-11-25" },
      );
      expect(legacy.status).toBe(200);
      expect(legacy.body).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [{ type: "text", text: "ok" }],
          structuredContent: { result: "ok" },
        },
      });
      expect(seen?.protocolVersion).toBeUndefined();

      const discover = await post(
        {
          id: 4,
          method: "server/discover",
          params: { _meta: modernMeta() },
        },
        modernHeaders("server/discover"),
      );
      expect(discover.status).toBe(200);
      expect(discover.body.result.supportedVersions).toEqual(dualEra());
      await alepha.stop();
    });
  });
});
