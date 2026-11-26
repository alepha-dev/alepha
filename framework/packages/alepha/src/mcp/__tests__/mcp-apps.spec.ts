import { EventEmitter } from "node:events";

import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $resource,
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_APP_MIME_TYPE,
  MCP_APPS_EXTENSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StdioMcpTransport } from "../transports/StdioMcpTransport.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MCP Apps, the wire (io.modelcontextprotocol/ui, spec 2026-01-26): a `ui://`
 * resource served as `text/html;profile=mcp-app`, linked from a tool by
 * `_meta.ui.resourceUri`. `_meta.ui` reaches every client, whatever its era,
 * transport or declaration.
 */

const MODERN = "2026-07-28";
const HTML = "<!doctype html><title>Sales</title><div id=chart></div>";

class Charts {
  chart = $resource({
    uri: "ui://charts/sales",
    description: "The sales chart view",
    ui: {
      csp: { connectDomains: ["https://api.example.app"] },
      prefersBorder: true,
    },
    _meta: { ui: { domain: "charts.example.app", prefersBorder: false } },
    handler: async () => ({ text: HTML }),
  });

  sales = $tool({
    description: "Sales for a quarter",
    schema: {
      params: z.object({ quarter: z.text() }),
      result: z.object({ total: z.number() }),
    },
    ui: { resource: this.chart },
    handler: async () => ({ total: 42 }),
  });

  refresh = $tool({
    description: "Refresh the chart's data, for the view only",
    ui: { resource: "ui://charts/sales", visibility: ["app"] },
    _meta: { ui: { resourceUri: "ui://ignored", custom: 1 }, other: true },
    handler: async () => "refreshed",
  });
}

class Plain {
  ping = $tool({ description: "Ping", handler: async () => "pong" });
}

const dualEra = (): string[] => [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
];

const capabilities = (declared: boolean) =>
  declared
    ? {
        extensions: {
          [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] },
        },
      }
    : {};

type Send = (
  method: string,
  params: Record<string, unknown>,
  declared: boolean,
) => Promise<any>;

/**
 * One way to reach the server, per transport and era. Each returns the
 * JSON-RPC response of one request.
 */
const transports: Record<
  string,
  (app: new () => object) => Promise<{ alepha: Alepha; send: Send }>
> = {
  "legacy HTTP": async (app) => {
    const { alepha, post } = await http(app);
    return {
      alepha,
      send: (method, params) =>
        post(
          { method, params },
          {
            "mcp-protocol-version": MCP_LEGACY_PROTOCOL_VERSION,
          },
        ),
    };
  },
  "modern HTTP": async (app) => {
    const { alepha, post } = await http(app);
    return {
      alepha,
      send: (method, params, declared) =>
        post(
          {
            method,
            params: { ...params, _meta: modernMeta(declared) },
          },
          {
            "mcp-protocol-version": MODERN,
            "mcp-method": method,
            ...(typeof params.name === "string"
              ? { "mcp-name": params.name }
              : typeof params.uri === "string"
                ? { "mcp-name": params.uri }
                : {}),
          },
        ),
    };
  },
  "legacy stdio": async (app) => {
    const { alepha, send } = await stdio(app);
    let initialized: boolean | undefined;
    return {
      alepha,
      send: async (method, params, declared) => {
        if (initialized !== declared) {
          initialized = declared;
          await send("initialize", {
            protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
            capabilities: capabilities(declared),
            clientInfo: { name: "legacy", version: "1.0.0" },
          });
        }
        return send(method, params);
      },
    };
  },
  "modern stdio": async (app) => {
    const { alepha, send } = await stdio(app);
    return {
      alepha,
      send: (method, params, declared) =>
        send(method, { ...params, _meta: modernMeta(declared) }),
    };
  },
};

const modernMeta = (declared: boolean) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": capabilities(declared),
});

let nextId = 1;

const http = async (app: new () => object) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(app);
  await alepha.start();
  alepha.inject(McpServerProvider).protocolVersions = dualEra();
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
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, ...body }),
    });
    return res.json();
  };
  return { alepha, post };
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
}

const fake = new FakeProcess();

class TestStdioTransport extends StdioMcpTransport {
  protected process(): any {
    return fake;
  }
}

const stdio = async (app: new () => object) => {
  fake.stdoutChunks = [];
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaMcp)
    .with(TestStdioTransport)
    .with(app);
  await alepha.start();
  alepha.inject(McpServerProvider).protocolVersions = dualEra();
  const send = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    fake.stdin.emit(
      "data",
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    return fake.stdoutChunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((message) => message.id === id);
  };
  return { alepha, send };
};

const EXPECTED_RESOURCE_UI = {
  domain: "charts.example.app",
  csp: { connectDomains: ["https://api.example.app"] },
  prefersBorder: true,
};

// ---------------------------------------------------------------------------------------------------------------------

describe("MCP Apps wire", () => {
  describe("descriptors", () => {
    it("serves a ui:// resource as text/html;profile=mcp-app, its typed ui merged over _meta.ui", async ({
      expect,
    }) => {
      const { alepha, send } = await transports["legacy HTTP"](Charts);

      const list = await send("resources/list", {}, false);
      expect(list.result.resources[0]).toMatchObject({
        uri: "ui://charts/sales",
        mimeType: MCP_APP_MIME_TYPE,
        _meta: { ui: EXPECTED_RESOURCE_UI },
      });

      const read = await send(
        "resources/read",
        { uri: "ui://charts/sales" },
        false,
      );
      expect(read.result.contents).toEqual([
        {
          uri: "ui://charts/sales",
          mimeType: MCP_APP_MIME_TYPE,
          text: HTML,
          _meta: { ui: EXPECTED_RESOURCE_UI },
        },
      ]);
      await alepha.stop();
    });

    it("links a tool to its view, typed keys winning and hand-written ones surviving", async ({
      expect,
    }) => {
      const { alepha, send } = await transports["legacy HTTP"](Charts);

      const { tools } = (await send("tools/list", {}, false)).result;
      const sales = tools.find((it: any) => it.name === "sales");
      const refresh = tools.find((it: any) => it.name === "refresh");
      expect(sales._meta).toEqual({ ui: { resourceUri: "ui://charts/sales" } });
      expect(refresh._meta).toEqual({
        ui: {
          resourceUri: "ui://charts/sales",
          visibility: ["app"],
          custom: 1,
        },
        other: true,
      });
      await alepha.stop();
    });

    it("declares the extension once a UI resource exists, and not before", async ({
      expect,
    }) => {
      const withUi = await http(Charts);
      const init = await withUi.post(
        {
          method: "initialize",
          params: {
            protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "legacy", version: "1.0.0" },
          },
        },
        {},
      );
      expect(init.result.capabilities.extensions).toEqual({
        [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] },
      });
      await withUi.alepha.stop();

      const plain = await http(Plain);
      const discover = await plain.post(
        { method: "server/discover", params: { _meta: modernMeta(false) } },
        { "mcp-protocol-version": MODERN, "mcp-method": "server/discover" },
      );
      expect(discover.result.capabilities).not.toHaveProperty("extensions");
      await plain.alepha.stop();
    });
  });

  for (const [label, connect] of Object.entries(transports)) {
    describe(`to every client, ${label}`, () => {
      it("sends the same tools/list and resources/list whether or not the client declared the extension", async ({
        expect,
      }) => {
        const { alepha, send } = await connect(Charts);

        const declared = (await send("tools/list", {}, true)).result;
        const undeclared = (await send("tools/list", {}, false)).result;
        expect(declared.tools).toEqual(undeclared.tools);
        expect(
          declared.tools.find((it: any) => it.name === "sales")._meta.ui,
        ).toEqual({ resourceUri: "ui://charts/sales" });

        const withExt = (await send("resources/list", {}, true)).result;
        const without = (await send("resources/list", {}, false)).result;
        expect(withExt.resources).toEqual(without.resources);
        expect(without.resources[0]._meta.ui).toEqual(EXPECTED_RESOURCE_UI);
        await alepha.stop();
      });

      it("answers a tool with a view with a text result that stands alone", async ({
        expect,
      }) => {
        const { alepha, send } = await connect(Charts);

        const call = await send(
          "tools/call",
          { name: "sales", arguments: { quarter: "Q1" } },
          false,
        );
        expect(call.result.content).toEqual([
          { type: "text", text: JSON.stringify({ total: 42 }) },
        ]);
        expect(call.result.structuredContent).toEqual({ total: 42 });
        await alepha.stop();
      });
    });
  }
});
