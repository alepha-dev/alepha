import { Alepha, z } from "alepha";
import { describe, expect, it, test } from "vitest";
import {
  $prompt,
  $resource,
  $tool,
  AlephaMcp,
  MCP_PROTOCOL_VERSION,
  type McpContext,
  McpForbiddenError,
  McpServerProvider,
  McpUnauthorizedError,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("McpServerProvider", () => {
  describe("initialization", () => {
    test("should handle initialize request", async () => {
      const alepha = Alepha.create();

      class Empty {}

      alepha.with(AlephaMcp).with(Empty);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });

      expect(response).not.toBeNull();
      expect(response?.result).toEqual({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        serverInfo: { name: "alepha-mcp", version: "1.0.0" },
      });
    });

    test("should handle ping request", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

      expect(response?.result).toEqual({});
    });
  });

  describe("capabilities", () => {
    test("should report empty capabilities when no primitives registered", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const capabilities = provider.getCapabilities();

      expect(capabilities).toEqual({
        tools: undefined,
        resources: undefined,
        prompts: undefined,
      });
    });

    test("should report tools capability when tools registered", async () => {
      const alepha = Alepha.create();

      class Tools {
        tool = $tool({
          description: "A tool",
          handler: async () => "result",
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const capabilities = provider.getCapabilities();

      expect(capabilities.tools).toEqual({});
      expect(capabilities.resources).toBeUndefined();
      expect(capabilities.prompts).toBeUndefined();
    });

    test("should report resources capability when resources registered", async () => {
      const alepha = Alepha.create();

      class Resources {
        resource = $resource({
          uri: "test://resource",
          handler: async () => ({ text: "content" }),
        });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const capabilities = provider.getCapabilities();

      expect(capabilities.resources).toEqual({});
    });

    test("should report prompts capability when prompts registered", async () => {
      const alepha = Alepha.create();

      class Prompts {
        prompt = $prompt({
          handler: async () => [{ role: "user", content: "test" }],
        });
      }

      alepha.with(AlephaMcp).with(Prompts);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const capabilities = provider.getCapabilities();

      expect(capabilities.prompts).toEqual({});
    });

    test("should report all capabilities when all primitives registered", async () => {
      const alepha = Alepha.create();

      class All {
        tool = $tool({ description: "Tool", handler: async () => {} });
        resource = $resource({
          uri: "test://r",
          handler: async () => ({ text: "" }),
        });
        prompt = $prompt({ handler: async () => [] });
      }

      alepha.with(AlephaMcp).with(All);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const capabilities = provider.getCapabilities();

      expect(capabilities.tools).toEqual({});
      expect(capabilities.resources).toEqual({});
      expect(capabilities.prompts).toEqual({});
    });
  });

  describe("tools/list", () => {
    test("should list all registered tools", async () => {
      const alepha = Alepha.create();

      class Calculator {
        add = $tool({
          description: "Add numbers",
          schema: { params: z.object({ a: z.number(), b: z.number() }) },
          handler: async ({ params }) => params.a + params.b,
        });

        subtract = $tool({
          description: "Subtract numbers",
          schema: { params: z.object({ a: z.number(), b: z.number() }) },
          handler: async ({ params }) => params.a - params.b,
        });
      }

      alepha.with(AlephaMcp).with(Calculator);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      const result = response?.result as {
        tools: Array<{ name: string; description: string }>;
      };
      expect(result.tools).toHaveLength(2);
      expect(result.tools.find((t) => t.name === "add")).toBeDefined();
      expect(result.tools.find((t) => t.name === "subtract")).toBeDefined();
    });
  });

  describe("tools/call", () => {
    test("should call tool and return result", async () => {
      const alepha = Alepha.create();

      class Calculator {
        multiply = $tool({
          description: "Multiply",
          schema: {
            params: z.object({ a: z.number(), b: z.number() }),
            result: z.number(),
          },
          handler: async ({ params }) => params.a * params.b,
        });
      }

      alepha.with(AlephaMcp).with(Calculator);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "multiply",
          arguments: { a: 6, b: 7 },
        },
      });

      const result = response?.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe("42");
    });

    test("passes raw MCP content (e.g. image) through verbatim when the tool has no output schema", async () => {
      const alepha = Alepha.create();

      class ImageTools {
        screenshot = $tool({
          description: "Return a tiny image",
          // No `result` schema — handler returns raw MCP content blocks.
          handler: async () => ({
            content: [
              {
                type: "image",
                data: "aGVsbG8=",
                mimeType: "image/png",
              },
            ],
          }),
        });
      }

      alepha.with(AlephaMcp).with(ImageTools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "screenshot", arguments: {} },
      });

      const result = response?.result as {
        content: Array<{ type: string; data?: string; mimeType?: string }>;
        structuredContent?: unknown;
      };
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("image");
      expect(result.content[0].data).toBe("aGVsbG8=");
      expect(result.content[0].mimeType).toBe("image/png");
      // Raw content is NOT double-wrapped into a JSON text block.
      expect(result.structuredContent).toBeUndefined();
    });

    test("a plain object result (no content array) still serializes to a JSON text block", async () => {
      const alepha = Alepha.create();

      class PlainTools {
        info = $tool({
          description: "Return a plain object",
          // No `result` schema, but the object is not raw MCP content.
          handler: async () => ({ hello: "world" }),
        });
      }

      alepha.with(AlephaMcp).with(PlainTools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "info", arguments: {} },
      });

      const result = response?.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual({ hello: "world" });
    });

    test("should return error for unknown tool", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "unknown-tool",
          arguments: {},
        },
      });

      expect(response?.error).toBeDefined();
      expect(response?.error?.message).toContain("unknown-tool");
    });

    test("should return isError for handler errors", async () => {
      const alepha = Alepha.create();

      class Tools {
        failing = $tool({
          description: "Failing tool",
          handler: async () => {
            throw new Error("Tool execution failed");
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "failing", arguments: {} },
      });

      const result = response?.result as {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Tool execution failed");
    });
  });

  describe("resources/list", () => {
    test("should list all registered resources", async () => {
      const alepha = Alepha.create();

      class Resources {
        readme = $resource({
          uri: "file:///readme",
          name: "README",
          description: "Project readme",
          handler: async () => ({ text: "# README" }),
        });

        config = $resource({
          uri: "config://app",
          name: "Config",
          mimeType: "application/json",
          handler: async () => ({ text: "{}" }),
        });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      });

      const result = response?.result as {
        resources: Array<{ uri: string; name: string }>;
      };
      expect(result.resources).toHaveLength(2);
      expect(
        result.resources.find((r) => r.uri === "file:///readme"),
      ).toBeDefined();
      expect(
        result.resources.find((r) => r.uri === "config://app"),
      ).toBeDefined();
    });
  });

  describe("resources/read", () => {
    test("should read resource content", async () => {
      const alepha = Alepha.create();

      class Resources {
        text = $resource({
          uri: "text://hello",
          mimeType: "text/plain",
          handler: async () => ({ text: "Hello, World!" }),
        });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "text://hello" },
      });

      const result = response?.result as {
        contents: Array<{ uri: string; text: string }>;
      };
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe("text://hello");
      expect(result.contents[0].text).toBe("Hello, World!");
    });

    test("should return error for unknown resource", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "unknown://resource" },
      });

      expect(response?.error).toBeDefined();
      expect(response?.error?.message).toContain("unknown://resource");
    });

    test("should handle binary content", async () => {
      const alepha = Alepha.create();

      const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes

      class Resources {
        binary = $resource({
          uri: "binary://data",
          mimeType: "application/octet-stream",
          handler: async () => ({ blob: binaryData }),
        });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "binary://data" },
      });

      const result = response?.result as { contents: Array<{ blob: string }> };
      expect(result.contents[0].blob).toBe(
        Buffer.from(binaryData).toString("base64"),
      );
    });
  });

  describe("prompts/list", () => {
    test("should list all registered prompts", async () => {
      const alepha = Alepha.create();

      class Prompts {
        greeting = $prompt({
          description: "Generate greeting",
          args: z.object({ name: z.text() }),
          handler: async () => [],
        });

        review = $prompt({
          description: "Code review",
          handler: async () => [],
        });
      }

      alepha.with(AlephaMcp).with(Prompts);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/list",
      });

      const result = response?.result as { prompts: Array<{ name: string }> };
      expect(result.prompts).toHaveLength(2);
      expect(result.prompts.find((p) => p.name === "greeting")).toBeDefined();
      expect(result.prompts.find((p) => p.name === "review")).toBeDefined();
    });
  });

  describe("prompts/get", () => {
    test("should get prompt messages", async () => {
      const alepha = Alepha.create();

      class Prompts {
        greeting = $prompt({
          description: "Generate greeting",
          args: z.object({ name: z.text() }),
          handler: async ({ args }) => [
            { role: "user", content: `Say hello to ${args.name}` },
          ],
        });
      }

      alepha.with(AlephaMcp).with(Prompts);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "greeting", arguments: { name: "World" } },
      });

      const result = response?.result as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.text).toBe("Say hello to World");
    });

    test("should return error for unknown prompt", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "unknown-prompt" },
      });

      expect(response?.error).toBeDefined();
      expect(response?.error?.message).toContain("unknown-prompt");
    });
  });

  describe("notifications", () => {
    test("should not return response for notifications", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      expect(response).toBeNull();
    });
  });

  describe("cancellation", () => {
    /**
     * A tool that parks until the test releases it, so a cancellation can
     * arrive while it is genuinely in flight.
     */
    const slowContainer = async () => {
      let release: (() => void) | undefined;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const observed = { aborted: false, finished: false };

      class Tools {
        slow = $tool({
          description: "Parks until released",
          schema: { result: z.text() },
          handler: async ({ context }) => {
            await parked;
            observed.aborted = context?.signal?.aborted ?? false;
            observed.finished = true;
            return "done";
          },
        });
      }

      const alepha = Alepha.create().with(AlephaMcp).with(Tools);
      await alepha.start();

      return {
        provider: alepha.inject(McpServerProvider),
        release: release!,
        observed,
      };
    };

    it("aborts the handler's signal and suppresses the response", async () => {
      const { provider, release, observed } = await slowContainer();

      const call = provider.handleMessage({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "slow", arguments: {} },
      });

      await provider.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 7 },
      });

      release();
      const response = await call;

      expect(observed.aborted).toBe(true);
      // Not an error response, not a late result: nothing at all.
      expect(response).toBeNull();
    });

    it("leaves an uncancelled request alone", async () => {
      const { provider, release, observed } = await slowContainer();

      const call = provider.handleMessage({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "slow", arguments: {} },
      });

      release();
      const response = await call;

      expect(observed.aborted).toBe(false);
      expect(observed.finished).toBe(true);
      expect(response?.result).toBeDefined();
    });

    it("ignores a cancellation for a request that is not running", async () => {
      const alepha = Alepha.create().with(AlephaMcp);
      await alepha.start();
      const provider = alepha.inject(McpServerProvider);

      expect(provider.cancelRequest(999)).toBe(false);
    });

    /**
     * JSON-RPC ids are unique per connection, and this server has no session
     * concept — so without a client key two callers both using `id: 1` would
     * share one cancellation slot.
     */
    it("does not let one client cancel another's request", async () => {
      const { provider, release, observed } = await slowContainer();

      const call = provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "slow", arguments: {} },
        },
        { clientKey: "alice" },
      );

      await provider.handleMessage(
        {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: 1 },
        },
        { clientKey: "mallory" },
      );

      release();
      const response = await call;

      expect(observed.aborted).toBe(false);
      expect(response?.result).toBeDefined();
    });
  });

  describe("list pagination", () => {
    /**
     * Seven tools, registered in declaration order — which is the order
     * `tools/list` pages through, because the registry is a Map filled once at
     * container start.
     */
    class SevenTools {
      tool0 = $tool({ description: "0", handler: async () => 0 });
      tool1 = $tool({ description: "1", handler: async () => 1 });
      tool2 = $tool({ description: "2", handler: async () => 2 });
      tool3 = $tool({ description: "3", handler: async () => 3 });
      tool4 = $tool({ description: "4", handler: async () => 4 });
      tool5 = $tool({ description: "5", handler: async () => 5 });
      tool6 = $tool({ description: "6", handler: async () => 6 });
    }

    const withTools = async (pageSize: number) => {
      const alepha = Alepha.create().with(AlephaMcp).with(SevenTools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      provider.pageSize = pageSize;
      return provider;
    };

    const list = async (
      provider: McpServerProvider,
      params: Record<string, unknown> = {},
    ) => {
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params,
      });
      return response as {
        result?: { tools: Array<{ name: string }>; nextCursor?: string };
        error?: { code: number };
      };
    };

    it("returns page one and a cursor when the registry overflows", async () => {
      const provider = await withTools(2);

      const first = await list(provider);

      expect(first.result?.tools.map((t) => t.name)).toEqual([
        "tool0",
        "tool1",
      ]);
      expect(first.result?.nextCursor).toBeTruthy();
    });

    it("omits nextCursor when everything fits", async () => {
      const provider = await withTools(100);

      const only = await list(provider);

      expect(only.result?.tools).toHaveLength(7);
      expect(only.result?.nextCursor).toBeUndefined();
    });

    it("traverses the full list exactly once", async () => {
      const provider = await withTools(3);

      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const page = await list(provider, cursor ? { cursor } : {});
        seen.push(...(page.result?.tools.map((t) => t.name) ?? []));
        cursor = page.result?.nextCursor;
      } while (cursor && ++guard < 20);

      expect(seen).toEqual([
        "tool0",
        "tool1",
        "tool2",
        "tool3",
        "tool4",
        "tool5",
        "tool6",
      ]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("rejects a malformed cursor with -32602 rather than resetting", async () => {
      const provider = await withTools(2);

      const bad = await list(provider, { cursor: "not-a-cursor" });

      expect(bad.result).toBeUndefined();
      expect(bad.error?.code).toBe(-32602);
    });

    /**
     * Offsets mean different things in different registries, so a cursor is
     * tagged with the list that minted it.
     */
    it("rejects a cursor minted for another list", async () => {
      const provider = await withTools(2);
      const cursor = (await list(provider)).result?.nextCursor;

      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/list",
        params: { cursor },
      });

      expect(response?.error?.code).toBe(-32602);
    });
  });

  describe("error attribution", () => {
    const call = async (alepha: Alepha, name: string, args = {}) =>
      alepha.inject(McpServerProvider).handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });

    it("keeps an input violation a self-correctable tool error", async () => {
      const alepha = Alepha.create();

      class Tools {
        double = $tool({
          description: "Double a number",
          schema: { params: z.object({ n: z.number() }), result: z.number() },
          handler: async ({ params }) => params.n * 2,
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const response = await call(alepha, "double", { n: "not a number" });
      const result = response?.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(response?.error).toBeUndefined();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("/n");
    });

    /**
     * The failure this pins: a handler breaking its OWN output contract used
     * to be reported as `Validation error at /n`, naming a path the caller
     * never sent. The model would retry forever adjusting arguments that were
     * never the problem.
     */
    it("reports an output violation as a server error, not an input path", async () => {
      const alepha = Alepha.create();

      class Tools {
        broken = $tool({
          description: "Declares a number, returns a string",
          schema: { params: z.object({ n: z.number() }), result: z.number() },
          handler: async () => "definitely not a number" as any,
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const response = await call(alepha, "broken", { n: 1 });

      expect(response?.result).toBeUndefined();
      expect(response?.error?.code).toBe(-32603);
      expect(response?.error?.message).toContain("output schema");
      expect(response?.error?.message).toContain("broken");
    });

    /**
     * McpUnauthorizedError / McpForbiddenError were exported with dedicated
     * codes that the tool-error catch discarded, making them dead public API.
     */
    it.each([
      [McpUnauthorizedError, -32001],
      [McpForbiddenError, -32003],
    ])("honours %s thrown by a handler", async (ErrorClass, code) => {
      const alepha = Alepha.create();

      class Tools {
        guarded = $tool({
          description: "Refuses",
          handler: async () => {
            throw new ErrorClass("nope");
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const response = await call(alepha, "guarded");

      expect(response?.result).toBeUndefined();
      expect(response?.error?.code).toBe(code);
      expect(response?.error?.message).toBe("nope");
    });

    it("still reports an ordinary handler throw as a tool error", async () => {
      const alepha = Alepha.create();

      class Tools {
        boom = $tool({
          description: "Throws",
          handler: async () => {
            throw new Error("kaboom");
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const response = await call(alepha, "boom");
      const result = response?.result as { isError?: boolean };

      expect(response?.error).toBeUndefined();
      expect(result.isError).toBe(true);
    });
  });

  describe("invalid params", () => {
    /**
     * `-32601` means "the method `tools/call` does not exist", which a
     * conforming client can read as "this server has no tools at all". An
     * unknown NAME is a bad argument to a method that does exist: `-32602`.
     */
    it.each([
      ["tools/call", { name: "nope" }],
      ["resources/read", { uri: "nope://x" }],
      ["prompts/get", { name: "nope" }],
    ])("%s with an unknown name yields -32602", async (method, params) => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const response = await alepha
        .inject(McpServerProvider)
        .handleMessage({ jsonrpc: "2.0", id: 1, method, params });

      expect(response?.error?.code).toBe(-32602);
    });

    /**
     * `params.name as string` on an absent field used to reach the registry
     * and come back as "Unknown tool: undefined" — a not-found error for a
     * tool the caller never named.
     */
    it.each([
      ["tools/call", "name"],
      ["resources/read", "uri"],
      ["prompts/get", "name"],
    ])(
      "%s without %s yields -32602 naming the field",
      async (method, field) => {
        const alepha = Alepha.create();
        alepha.with(AlephaMcp);
        await alepha.start();

        const response = await alepha
          .inject(McpServerProvider)
          .handleMessage({ jsonrpc: "2.0", id: 1, method, params: {} });

        expect(response?.error?.code).toBe(-32602);
        expect(response?.error?.message).toContain(field);
        expect(response?.error?.message).not.toContain("undefined");
      },
    );
  });

  describe("unknown methods", () => {
    test("should return method not found error", async () => {
      const alepha = Alepha.create();
      alepha.with(AlephaMcp);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const response = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
      });

      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32601); // METHOD_NOT_FOUND
      expect(response?.error?.message).toContain("unknown/method");
    });
  });

  describe("getters", () => {
    test("should return all tools", async () => {
      const alepha = Alepha.create();

      class Tools {
        a = $tool({ description: "A", handler: async () => {} });
        b = $tool({ description: "B", handler: async () => {} });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const tools = provider.getTools();

      expect(tools).toHaveLength(2);
    });

    test("should return all resources", async () => {
      const alepha = Alepha.create();

      class Resources {
        a = $resource({ uri: "a://", handler: async () => ({ text: "" }) });
        b = $resource({ uri: "b://", handler: async () => ({ text: "" }) });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const resources = provider.getResources();

      expect(resources).toHaveLength(2);
    });

    test("should return all prompts", async () => {
      const alepha = Alepha.create();

      class Prompts {
        a = $prompt({ handler: async () => [] });
        b = $prompt({ handler: async () => [] });
      }

      alepha.with(AlephaMcp).with(Prompts);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const prompts = provider.getPrompts();

      expect(prompts).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------
  // Context tests
  // -----------------------------------------------------------------------------------------------------------------

  describe("context passing", () => {
    test("should pass context to tools/call", async () => {
      const alepha = Alepha.create();

      let receivedContext: McpContext | undefined;

      class Tools {
        contextTool = $tool({
          description: "Tool that receives context",
          schema: {
            params: z.object({ value: z.text() }),
            result: z.text(),
          },
          handler: async ({ params, context }) => {
            receivedContext = context;
            return `Received: ${params.value}`;
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const context: McpContext = {
        headers: { authorization: "Bearer test-token-123" },
        data: { userId: "user-1", projectId: 42 },
      };

      await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "contextTool", arguments: { value: "test" } },
        },
        context,
      );

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.headers?.authorization).toBe(
        "Bearer test-token-123",
      );
      expect(receivedContext?.data).toEqual({
        userId: "user-1",
        projectId: 42,
      });
    });

    test("should pass context to resources/read", async () => {
      const alepha = Alepha.create();

      let receivedContext: McpContext | undefined;

      class Resources {
        contextResource = $resource({
          uri: "context://test",
          handler: async ({ context }) => {
            receivedContext = context;
            return { text: "content" };
          },
        });
      }

      alepha.with(AlephaMcp).with(Resources);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const context: McpContext = {
        headers: { "x-custom-header": "custom-value" },
      };

      await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "context://test" },
        },
        context,
      );

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.headers?.["x-custom-header"]).toBe(
        "custom-value",
      );
    });

    test("should pass context to prompts/get", async () => {
      const alepha = Alepha.create();

      let receivedContext: McpContext | undefined;

      class Prompts {
        contextPrompt = $prompt({
          description: "Prompt that receives context",
          args: z.object({ name: z.text() }),
          handler: async ({ args, context }) => {
            receivedContext = context;
            return [{ role: "user", content: `Hello ${args.name}` }];
          },
        });
      }

      alepha.with(AlephaMcp).with(Prompts);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);
      const context: McpContext = {
        headers: { authorization: "Bearer prompt-token" },
        data: { role: "admin" },
      };

      await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "prompts/get",
          params: { name: "contextPrompt", arguments: { name: "World" } },
        },
        context,
      );

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.headers?.authorization).toBe(
        "Bearer prompt-token",
      );
      expect(receivedContext?.data).toEqual({ role: "admin" });
    });

    test("should work when the transport supplies no context", async () => {
      const alepha = Alepha.create();

      let seen: McpContext | undefined;

      class Tools {
        noContextTool = $tool({
          description: "Tool without context",
          handler: async ({ context }) => {
            seen = context;
            return "done";
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);

      // Call without context parameter
      await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "noContextTool", arguments: {} },
      });

      // handleMessage always hands down a context, because there is always a
      // cancellation signal to hand over — but nothing else is invented.
      expect(seen?.headers).toBeUndefined();
      expect(seen?.data).toBeUndefined();
      expect(seen?.signal).toBeInstanceOf(AbortSignal);
    });

    test("should use context for authentication in tools", async () => {
      const alepha = Alepha.create();

      class Tools {
        protected = $tool({
          description: "Protected tool",
          schema: { result: z.text() },
          handler: async ({ context }) => {
            const auth = context?.headers?.authorization;
            if (!auth?.toString().startsWith("Bearer ")) {
              throw new Error("Unauthorized");
            }
            return "Access granted";
          },
        });
      }

      alepha.with(AlephaMcp).with(Tools);
      await alepha.start();

      const provider = alepha.inject(McpServerProvider);

      // Without auth - should return error in result
      const response1 = await provider.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "protected", arguments: {} },
      });

      expect((response1?.result as any)?.isError).toBe(true);
      expect((response1?.result as any)?.content[0].text).toContain(
        "Unauthorized",
      );

      // With auth - should succeed
      const response2 = await provider.handleMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "protected", arguments: {} },
        },
        { headers: { authorization: "Bearer valid-token" } },
      );

      expect((response2?.result as any)?.isError).toBeUndefined();
      expect((response2?.result as any)?.content[0].text).toBe(
        "Access granted",
      );
    });
  });
});
