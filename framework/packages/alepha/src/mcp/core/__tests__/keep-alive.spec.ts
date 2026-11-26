import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaMcp } from "../index.ts";
import { $tool } from "../primitives/$tool.ts";
import {
  mcpStreamableHttpOptions,
  StreamableHttpMcpTransport,
} from "../transports/StreamableHttpMcpTransport.ts";

/**
 * SSE comment keep-alives on a progress stream: sent while a slow handler
 * runs, never after the final response, and their timer cleared on close and
 * on cancellation.
 */

class SlowTools {
  slow = $tool({
    description: "Sleeps, then answers",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 150);
        context?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return "done";
    },
  });
}

class TestTransport extends StreamableHttpMcpTransport {
  public openKeepAlives(): number {
    return this.keepAlives.size;
  }
}

const start = async (keepAliveInterval: number) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with({ provide: StreamableHttpMcpTransport, use: TestTransport })
    .with(SlowTools);
  alepha.set(mcpStreamableHttpOptions, {
    ...mcpStreamableHttpOptions.options.default,
    keepAliveInterval,
  });
  await alepha.start();
  return {
    alepha,
    transport: alepha.inject(TestTransport),
    url: `${alepha.inject(ServerProvider).hostname}/mcp`,
  };
};

const call = (url: string, signal?: AbortSignal) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "slow", arguments: {}, _meta: { progressToken: "t" } },
    }),
  });

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("StreamableHttpMcpTransport: SSE keep-alives", () => {
  it("sends comment keep-alives while the handler runs, then the response", async () => {
    const { alepha, transport, url } = await start(25);

    const text = await (await call(url)).text();
    const chunks = text.split("\n\n").filter(Boolean);

    const comments = chunks.filter((c) => c === ": keep-alive");
    expect(comments.length).toBeGreaterThanOrEqual(2);
    // The final response is the last event: nothing follows it.
    const last = chunks[chunks.length - 1] ?? "";
    expect(last.startsWith("data: ")).toBe(true);
    expect(JSON.parse(last.slice(6)).result.content[0].text).toBe("done");
    expect(transport.openKeepAlives()).toBe(0);
    await alepha.stop();
  });

  it("sends none when the interval is 0", async () => {
    const { alepha, transport, url } = await start(0);

    const text = await (await call(url)).text();

    expect(text).not.toContain(": keep-alive");
    expect(transport.openKeepAlives()).toBe(0);
    await alepha.stop();
  });

  it("clears the timer when the client disconnects", async () => {
    const { alepha, transport, url } = await start(20);
    const abort = new AbortController();

    const res = await call(url, abort.signal);
    const reader = res.body!.getReader();
    await reader.read();
    expect(transport.openKeepAlives()).toBe(1);
    abort.abort();
    await sleep(80);

    expect(transport.openKeepAlives()).toBe(0);
    await alepha.stop();
  });
});

describe("StreamableHttpMcpTransport: clientCapabilities over HTTP", () => {
  const post = (url: string, meta: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            ...meta,
          },
        },
      }),
    });

  it("answers a modern request without clientCapabilities with 400 and -32602", async () => {
    const { alepha, url } = await start(0);

    const res = await post(url, {});

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain(
      "io.modelcontextprotocol/clientCapabilities",
    );
    await alepha.stop();
  });

  it("serves it once the field is declared, even empty", async () => {
    const { alepha, url } = await start(0);

    const res = await post(url, {
      "io.modelcontextprotocol/clientCapabilities": {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.tools[0].name).toBe("slow");
    await alepha.stop();
  });
});
