import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $prompt, $resource, $tool, AlephaMcp } from "../index.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The exact wire responses a legacy (2025-11-25 and earlier) client receives.
 *
 * Written BEFORE the dual-era work of epic #E57 touched the provider, against
 * the code every legacy client was already talking to, and meant to stay
 * green WITHOUT EDITS through the rest of the epic, the flip to 2026-07-28
 * included. A legacy client is never told it negotiated a modern revision and
 * never receives a field it did not receive before (`resultType`, `ttlMs`,
 * `cacheScope`, a serverInfo `_meta`).
 *
 * So the versions below are literals, never `MCP_PROTOCOL_VERSION`: that
 * constant moves to 2026-07-28 with the flip, and this file must not.
 */
describe("Legacy MCP wire responses", () => {
  class Calculator {
    add = $tool({
      description: "Add two numbers",
      schema: {
        params: z.object({ a: z.number(), b: z.number() }),
        result: z.object({ sum: z.number() }),
      },
      handler: async ({ params }) => ({ sum: params.a + params.b }),
    });

    readme = $resource({
      uri: "docs://readme",
      description: "The README",
      handler: async () => ({ text: "# Hello" }),
    });

    greet = $prompt({
      description: "Greet someone",
      args: z.object({ who: z.text() }),
      handler: async ({ args }) => [
        { role: "user", content: `Say hello to ${args.who}` },
      ],
    });
  }

  const start = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(Calculator);
    await alepha.start();
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;

    const post = async (
      body: Record<string, unknown>,
      headers: Record<string, string> = {
        "mcp-protocol-version": "2025-11-25",
      },
    ) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      });
      return { status: res.status, body: await res.json() };
    };

    return { alepha, post };
  };

  it("initialize echoes a legacy version", async () => {
    const { alepha, post } = await start();

    const res = await post(
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      },
      {},
    );

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "alepha-mcp", version: "1.0.0" },
        },
      },
    });
    await alepha.stop();
  });

  it("initialize never negotiates a modern or unknown version", async () => {
    const { alepha, post } = await start();

    for (const protocolVersion of ["2026-07-28", "1999-01-01"]) {
      const res = await post(
        {
          id: 1,
          method: "initialize",
          params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: "legacy", version: "1.0.0" },
          },
        },
        {},
      );

      expect(res).toEqual({
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "alepha-mcp", version: "1.0.0" },
          },
        },
      });
    }
    await alepha.stop();
  });

  it("tools/list", async () => {
    const { alepha, post } = await start();

    expect(await post({ id: 2, method: "tools/list" })).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [
            {
              name: "add",
              description: "Add two numbers",
              inputSchema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
              },
              outputSchema: {
                type: "object",
                properties: { sum: { type: "number" } },
                required: ["sum"],
                additionalProperties: false,
              },
            },
          ],
        },
      },
    });
    await alepha.stop();
  });

  it("tools/call, success", async () => {
    const { alepha, post } = await start();

    const res = await post({
      id: 3,
      method: "tools/call",
      params: { name: "add", arguments: { a: 2, b: 3 } },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [{ type: "text", text: '{"sum":5}' }],
          structuredContent: { sum: 5 },
        },
      },
    });
    await alepha.stop();
  });

  it("tools/call, isError", async () => {
    const { alepha, post } = await start();

    const res = await post({
      id: 4,
      method: "tools/call",
      params: { name: "add", arguments: { a: "two", b: 3 } },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 4,
        result: {
          content: [
            {
              type: "text",
              text: "Validation error at /a: Invalid input: expected number, received string",
            },
          ],
          structuredContent: {
            errors: [
              {
                path: "/a",
                message: "Invalid input: expected number, received string",
              },
            ],
          },
          isError: true,
        },
      },
    });
    await alepha.stop();
  });

  it("resources/read", async () => {
    const { alepha, post } = await start();

    const res = await post({
      id: 5,
      method: "resources/read",
      params: { uri: "docs://readme" },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 5,
        result: {
          contents: [
            { uri: "docs://readme", mimeType: "text/plain", text: "# Hello" },
          ],
        },
      },
    });
    await alepha.stop();
  });

  it("prompts/get", async () => {
    const { alepha, post } = await start();

    const res = await post({
      id: 6,
      method: "prompts/get",
      params: { name: "greet", arguments: { who: "Ada" } },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 6,
        result: {
          description: "Greet someone",
          messages: [
            {
              role: "user",
              content: { type: "text", text: "Say hello to Ada" },
            },
          ],
        },
      },
    });
    await alepha.stop();
  });

  it("an unknown tool is -32602", async () => {
    const { alepha, post } = await start();

    const res = await post({
      id: 7,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32602, message: "Unknown tool: nope" },
      },
    });
    await alepha.stop();
  });
});
