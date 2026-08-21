import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaMcp, McpServerProvider } from "../index.ts";
import { $tool } from "../primitives/$tool.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Read an SSE body to completion and return the parsed `data:` payloads, in
 * order. Deliberately reads the stream rather than `res.json()` — the ordering
 * is the thing under test.
 */
const readEvents = async (res: Response): Promise<any[]> => {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.replace(/^data: /, "").trim())
    .filter(Boolean)
    .map((json) => JSON.parse(json));
};

class ProgressTools {
  index = $tool({
    description: "Indexes three things, reporting progress",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      for (let i = 1; i <= 3; i++) {
        context?.reportProgress?.(i, 3, `step ${i}`);
      }
      return "indexed";
    },
  });

  quiet = $tool({
    description: "Reports nothing",
    schema: { result: z.text() },
    handler: async ({ context }) => (context?.reportProgress ? "has" : "none"),
  });
}

const start = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with(AlephaMcp)
    .with(StreamableHttpMcpTransport)
    .with(ProgressTools);
  await alepha.start();
  return {
    alepha,
    url: `${alepha.inject(ServerProvider).hostname}/mcp`,
  };
};

const call = (
  url: string,
  name: string,
  meta?: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {}, ...(meta ? { _meta: meta } : {}) },
    }),
  });

describe("StreamableHttpMcpTransport — SSE responses", () => {
  it("stays application/json when no progress token is attached", async () => {
    const { alepha, url } = await start();

    const res = await call(url, "index");

    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.result.content[0].text).toBe("indexed");
    await alepha.stop();
  });

  it("upgrades to text/event-stream when a progress token is attached", async () => {
    const { alepha, url } = await start();

    const res = await call(url, "index", { progressToken: "tok-1" });

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Without this, nginx buffers the stream and progress arrives all at once
    // at the end — which is the same as not streaming.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    await alepha.stop();
  });

  it("emits every notification before the final response, then closes", async () => {
    const { alepha, url } = await start();

    const events = await readEvents(
      await call(url, "index", { progressToken: "tok-1" }),
    );

    expect(events).toHaveLength(4);
    expect(events.slice(0, 3)).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "tok-1",
          progress: 1,
          total: 3,
          message: "step 1",
        },
      },
      expect.objectContaining({
        params: expect.objectContaining({ progress: 2 }),
      }),
      expect.objectContaining({
        params: expect.objectContaining({ progress: 3 }),
      }),
    ]);

    // The final message is the JSON-RPC response, and it comes last.
    expect(events[3]).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(events[3].result.content[0].text).toBe("indexed");
    await alepha.stop();
  });

  /**
   * A progress notification is addressed to a token. Without one there is
   * nowhere to send it, so `reportProgress` is absent rather than a silent
   * no-op the handler cannot distinguish.
   */
  it("leaves reportProgress undefined on a non-streaming call", async () => {
    const { alepha, url } = await start();

    const body = (await (await call(url, "quiet")).json()) as any;

    expect(body.result.content[0].text).toBe("none");
    await alepha.stop();
  });

  it("respects a client that accepts only JSON", async () => {
    const { alepha, url } = await start();

    const res = await call(
      url,
      "index",
      { progressToken: "tok-1" },
      { accept: "application/json" },
    );

    expect(res.headers.get("content-type")).toContain("application/json");
    await alepha.stop();
  });

  it("streams an error response rather than dropping the stream", async () => {
    class Failing {
      boom = $tool({
        description: "Throws a protocol error",
        schema: { params: z.object({ n: z.number() }), result: z.number() },
        handler: async () => "not a number" as any,
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "silent", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(Failing);
    await alepha.start();
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "boom",
          arguments: { n: 1 },
          _meta: { progressToken: "t" },
        },
      }),
    });

    const events = await readEvents(res);

    expect(events).toHaveLength(1);
    expect(events[0].error.code).toBe(-32603);
    await alepha.stop();
  });

  it("sends no final message for a cancelled request", async () => {
    let release: (() => void) | undefined;
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });

    class SlowTools {
      slow = $tool({
        description: "Parks",
        schema: { result: z.text() },
        handler: async () => {
          await parked;
          return "done";
        },
      });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(SlowTools);
    await alepha.start();
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

    const pending = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "slow",
          arguments: {},
          _meta: { progressToken: "t" },
        },
      }),
    });

    // Give the request time to reach the handler and park.
    await new Promise((resolve) => setTimeout(resolve, 50));
    alepha.inject(McpServerProvider).cancelRequest(5);
    release!();

    const events = await readEvents(await pending);

    expect(events).toEqual([]);
    await alepha.stop();
  });
});
