import { EventEmitter } from "node:events";

import { $inject, Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_LEGACY_PROTOCOL_VERSION,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StdioMcpTransport } from "../transports/StdioMcpTransport.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The `extensions` capability (2026-07-28): the server declares its own with
 * `registerExtension`, and reads the client's per request with
 * `clientExtension`, which answers the settings, `false` (known not
 * declared) or `undefined` (unknowable, legacy HTTP).
 */

const MODERN = "2026-07-28";
const EXT = "io.example/widgets";

const dualEra = (): string[] => [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
];

const seen: { value?: Record<string, unknown> | false | null } = {};

class Tools {
  protected readonly mcp = $inject(McpServerProvider);

  probe = $tool({
    description: "Report what the client declared for the test extension",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      seen.value = this.mcp.clientExtension(context, EXT) ?? null;
      return "ok";
    },
  });
}

const modernMeta = (capabilities: Record<string, unknown>) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": capabilities,
});

const http = async (register = true) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Tools);
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  mcp.protocolVersions = dualEra();
  if (register) {
    mcp.registerExtension(EXT, { level: 2 });
  }
  seen.value = undefined;
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
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { alepha, mcp, post };
};

class FakeProcess {
  stdin = new EventEmitter() as any;
  stdoutChunks: string[] = [];
  stdout = {
    write: (chunk: any) => {
      this.stdoutChunks.push(String(chunk));
      return true;
    },
  };
  stderr = { write: () => true };

  constructor() {
    this.stdin.setEncoding = () => {};
    this.stdin.resume = () => {};
  }

  get messages(): any[] {
    return this.stdoutChunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

const fake = new FakeProcess();

class TestStdioTransport extends StdioMcpTransport {
  protected process(): any {
    return fake;
  }
}

const stdio = async () => {
  fake.stdoutChunks = [];
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaMcp)
    .with(TestStdioTransport)
    .with(Tools);
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  mcp.protocolVersions = dualEra();
  mcp.registerExtension(EXT, { level: 2 });
  seen.value = undefined;
  const send = async (message: Record<string, unknown>) => {
    fake.stdin.emit(
      "data",
      `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { alepha, send };
};

const call = (id: number, meta?: Record<string, unknown>) => ({
  id,
  method: "tools/call",
  params: { name: "probe", arguments: {}, ...(meta ? { _meta: meta } : {}) },
});

// ---------------------------------------------------------------------------------------------------------------------

describe("MCP extensions capability", () => {
  describe("the server's declaration", () => {
    it("lists a registered extension on server/discover and initialize", async () => {
      const { alepha, post } = await http();

      const discover = await post(
        { id: 1, method: "server/discover", params: { _meta: modernMeta({}) } },
        { "mcp-protocol-version": MODERN, "mcp-method": "server/discover" },
      );
      expect(discover.body.result.capabilities.extensions).toEqual({
        [EXT]: { level: 2 },
      });

      const init = await post({
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      expect(init.body.result.capabilities.extensions).toEqual({
        [EXT]: { level: 2 },
      });
      await alepha.stop();
    });

    it("omits extensions when none is registered", async () => {
      const { alepha, mcp, post } = await http(false);

      expect(mcp.hasExtension(EXT)).toBe(false);
      const init = await post({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      expect(init.body.result.capabilities).not.toHaveProperty("extensions");
      await alepha.stop();
    });
  });

  describe("the client's declaration", () => {
    it("is read from _meta on modern HTTP", async () => {
      const { alepha, post } = await http();
      const headers = {
        "mcp-protocol-version": MODERN,
        "mcp-method": "tools/call",
        "mcp-name": "probe",
      };

      await post(
        call(1, modernMeta({ extensions: { [EXT]: { mode: "a" } } })),
        headers,
      );
      expect(seen.value).toEqual({ mode: "a" });

      await post(call(2, modernMeta({})), headers);
      expect(seen.value).toBe(false);
      await alepha.stop();
    });

    it("is unknowable on legacy HTTP", async () => {
      const { alepha, post } = await http();

      await post({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
          capabilities: { extensions: { [EXT]: {} } },
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      await post(call(2), {
        "mcp-protocol-version": MCP_LEGACY_PROTOCOL_VERSION,
      });

      expect(seen.value).toBeNull();
      await alepha.stop();
    });

    it("is read from _meta on modern stdio", async () => {
      const { alepha, send } = await stdio();

      await send(call(1, modernMeta({ extensions: { [EXT]: { mode: "b" } } })));
      expect(seen.value).toEqual({ mode: "b" });

      await send(call(2, modernMeta({})));
      expect(seen.value).toBe(false);
      await alepha.stop();
    });

    it("is kept from initialize on legacy stdio", async () => {
      const { alepha, send } = await stdio();

      await send(call(1));
      expect(seen.value).toBeNull();

      await send({
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
          capabilities: { extensions: { [EXT]: { mode: "c" } } },
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      await send(call(3));
      expect(seen.value).toEqual({ mode: "c" });
      expect(fake.messages.at(-1)).toMatchObject({ id: 3, result: {} });
      await alepha.stop();
    });

    it("is false on legacy stdio when initialize declared other extensions", async () => {
      const { alepha, send } = await stdio();

      await send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
          capabilities: { extensions: { "io.example/other": {} } },
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      });
      await send(call(2));

      expect(seen.value).toBe(false);
      await alepha.stop();
    });
  });
});
