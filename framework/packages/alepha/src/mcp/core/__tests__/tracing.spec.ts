import { $inject, Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { MemoryTraceProvider, Tracer } from "alepha/tracing";
import { describe, it } from "vitest";

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
 * The MCP span, and how it continues a caller's trace from `_meta.traceparent`
 * (SEP-414). The HTTP `traceparent` header wins when both are present.
 */

const MODERN = "2026-07-28";
const CALLER_TRACE = "0af7651916cd43dd8448eb211c80319c";
const CALLER_SPAN = "b7ad6b7169203331";
const CALLER = `00-${CALLER_TRACE}-${CALLER_SPAN}-01`;
const HEADER_TRACE = "4bf92f3577b34da6a3ce929b0e0e4736";
const HEADER = `00-${HEADER_TRACE}-00f067aa0ba902b7-01`;

const seen: { traceId?: string; recording?: boolean } = {};

class Tools {
  protected readonly tracer = $inject(Tracer);

  echo = $tool({
    description: "Echo, reporting the active span",
    schema: { result: z.text() },
    handler: async () => {
      const span = this.tracer.current();
      seen.traceId = span?.traceId;
      seen.recording = span?.recording;
      return "ok";
    },
  });

  broken = $tool({
    description: "Fails",
    schema: { result: z.text() },
    handler: async () => {
      throw new Error("boom");
    },
  });

  readme = $resource({
    uri: "docs://readme",
    description: "The README",
    handler: async () => ({ text: "# Hello" }),
  });

  greet = $prompt({
    description: "Greet someone",
    args: z.object({ who: z.text() }),
    handler: async ({ args }) => [{ role: "user", content: `Hi ${args.who}` }],
  });
}

const modernMeta = (extra: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  ...extra,
});

/**
 * A provider driven directly, as the stdio transport drives it: no headers,
 * no request root around the call.
 */
const direct = async (record = true) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaMcp)
    .with(Tools);
  const traces = record ? alepha.inject(MemoryTraceProvider) : undefined;
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  mcp.protocolVersions = [
    ...MODERN_PROTOCOL_VERSIONS,
    ...LEGACY_PROTOCOL_VERSIONS,
  ];
  seen.traceId = undefined;
  seen.recording = undefined;
  const send = (method: string, params: Record<string, unknown>) =>
    mcp.handleMessage(
      { jsonrpc: "2.0", id: 7, method, params },
      { clientKey: "stdio" },
    );
  return { alepha, traces, send };
};

const http = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(Tools);
  const traces = alepha.inject(MemoryTraceProvider);
  await alepha.start();
  const url = `${alepha.inject(ServerProvider).hostname}/mcp`;
  const call = async (meta?: Record<string, unknown>, header?: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(header ? { traceparent: header } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {},
          ...(meta ? { _meta: meta } : {}),
        },
      }),
    });
    return res.json();
  };
  return { alepha, traces, call };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("MCP tracing", () => {
  describe("the MCP span", () => {
    it("opens a server span per tools/call, named and attributed per the semantic conventions", async ({
      expect,
    }) => {
      const { alepha, traces, send } = await direct();

      await send("tools/call", { name: "echo", arguments: {} });

      const span = traces!.find("tools/call echo")!;
      expect(span).toBeDefined();
      expect(span.kind).toBe("server");
      expect(span.attributes).toMatchObject({
        "mcp.method.name": "tools/call",
        "jsonrpc.request.id": "7",
        "gen_ai.tool.name": "echo",
        "gen_ai.operation.name": "execute_tool",
      });
      expect(span.attributes).not.toHaveProperty("mcp.protocol.version");
      expect(seen.traceId).toBe(span.traceId);
      await alepha.stop();
    });

    it("opens one for resources/read and prompts/get, the URI kept out of the name", async ({
      expect,
    }) => {
      const { alepha, traces, send } = await direct();

      await send("resources/read", { uri: "docs://readme" });
      await send("prompts/get", { name: "greet", arguments: { who: "Ada" } });

      const read = traces!.find("resources/read")!;
      expect(read.attributes).toMatchObject({
        "mcp.method.name": "resources/read",
        "mcp.resource.uri": "docs://readme",
      });
      const prompt = traces!.find("prompts/get greet")!;
      expect(prompt.attributes).toMatchObject({
        "mcp.method.name": "prompts/get",
        "gen_ai.prompt.name": "greet",
      });
      await alepha.stop();
    });

    it("opens none for a list", async ({ expect }) => {
      const { alepha, traces, send } = await direct();

      await send("tools/list", {});

      expect(traces!.spans()).toHaveLength(0);
      await alepha.stop();
    });

    it("records a tool error and a JSON-RPC error", async ({ expect }) => {
      const { alepha, traces, send } = await direct();

      await send("tools/call", { name: "broken", arguments: {} });
      await send("tools/call", { name: "missing", arguments: {} });

      expect(traces!.find("tools/call broken")!.attributes).toMatchObject({
        "error.type": "tool_error",
      });
      const missing = traces!.find("tools/call missing")!;
      expect(missing.attributes["rpc.status_code"]).toBeDefined();
      expect(missing.status).toBe("error");
      await alepha.stop();
    });
  });

  describe("_meta.traceparent", () => {
    it("is continued on stdio, legacy era", async ({ expect }) => {
      const { alepha, traces, send } = await direct();

      await send("tools/call", {
        name: "echo",
        arguments: {},
        _meta: { traceparent: CALLER },
      });

      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).toBe(CALLER_TRACE);
      expect(span.parentSpanId).toBe(CALLER_SPAN);
      expect(span.links).toEqual([]);
      await alepha.stop();
    });

    it("is continued on stdio, modern era", async ({ expect }) => {
      const { alepha, traces, send } = await direct();

      await send("tools/call", {
        name: "echo",
        arguments: {},
        _meta: modernMeta({ traceparent: CALLER }),
      });

      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).toBe(CALLER_TRACE);
      expect(span.parentSpanId).toBe(CALLER_SPAN);
      expect(span.attributes["mcp.protocol.version"]).toBe(MODERN);
      await alepha.stop();
    });

    it("joins the caller's trace on HTTP and links to the request span", async ({
      expect,
    }) => {
      const { alepha, traces, call } = await http();

      await call({ traceparent: CALLER });

      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).toBe(CALLER_TRACE);
      expect(span.parentSpanId).toBe(CALLER_SPAN);
      const root = traces!.spans().find((it) => it.name.startsWith("POST"))!;
      expect(root).toBeDefined();
      expect(root.traceId).not.toBe(CALLER_TRACE);
      expect(span.links).toEqual([
        { traceId: root.traceId, spanId: root.spanId },
      ]);
      await alepha.stop();
    });

    it("is continued on HTTP in the modern era", async ({ expect }) => {
      const { alepha, traces } = await http();
      alepha.inject(McpServerProvider).protocolVersions = [
        ...MODERN_PROTOCOL_VERSIONS,
        ...LEGACY_PROTOCOL_VERSIONS,
      ];
      const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MODERN,
          "mcp-method": "tools/call",
          "mcp-name": "echo",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "echo",
            arguments: {},
            _meta: modernMeta({ traceparent: CALLER }),
          },
        }),
      });
      expect(res.status).toBe(200);
      await res.text();

      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).toBe(CALLER_TRACE);
      expect(span.links).toHaveLength(1);
      await alepha.stop();
    });

    it("loses to the HTTP header when both are present", async ({ expect }) => {
      const { alepha, traces, call } = await http();

      await call({ traceparent: CALLER }, HEADER);

      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).toBe(HEADER_TRACE);
      const root = traces!.spans().find((it) => it.name.startsWith("POST"))!;
      expect(span.parentSpanId).toBe(root.spanId);
      expect(span.links).toEqual([]);
      await alepha.stop();
    });

    it("is ignored when malformed on HTTP: the span stays in the request's trace", async ({
      expect,
    }) => {
      const { alepha, traces, call } = await http();

      await call({ traceparent: "00-not-a-trace-01" });

      const span = traces!.find("tools/call echo")!;
      const root = traces!.spans().find((it) => it.name.startsWith("POST"))!;
      expect(span.traceId).toBe(root.traceId);
      expect(span.parentSpanId).toBe(root.spanId);
      expect(span.links).toEqual([]);
      await alepha.stop();
    });

    it("is ignored when malformed, and never fails the call", async ({
      expect,
    }) => {
      const { alepha, traces, send } = await direct();

      const response = await send("tools/call", {
        name: "echo",
        arguments: {},
        _meta: { traceparent: "nonsense", tracestate: "x=1", baggage: "k=v" },
      });

      expect(response).toMatchObject({ result: { content: [{ text: "ok" }] } });
      const span = traces!.find("tools/call echo")!;
      expect(span.traceId).not.toBe(CALLER_TRACE);
      expect(span.parentSpanId).toBeUndefined();
      await alepha.stop();
    });
  });

  describe("with tracing off", () => {
    it("records nothing and opens no span without a traceparent", async ({
      expect,
    }) => {
      const { alepha, send } = await direct(false);

      await send("tools/call", { name: "echo", arguments: {} });

      expect(alepha.inject(Tracer).recording).toBe(false);
      expect(seen.traceId).toBeUndefined();
      await alepha.stop();
    });

    it("still carries the caller's trace on, unrecorded", async ({
      expect,
    }) => {
      const { alepha, send } = await direct(false);

      await send("tools/call", {
        name: "echo",
        arguments: {},
        _meta: { traceparent: CALLER },
      });

      expect(seen.traceId).toBe(CALLER_TRACE);
      expect(seen.recording).toBe(false);
      await alepha.stop();
    });
  });
});
