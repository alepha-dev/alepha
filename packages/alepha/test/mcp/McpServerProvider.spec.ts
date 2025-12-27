import { Alepha, t } from "alepha";
import {
  $prompt,
  $resource,
  $tool,
  AlephaMcp,
  MCP_PROTOCOL_VERSION,
  McpServerProvider,
} from "alepha/mcp";
import { describe, expect, test } from "vitest";

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
          schema: { params: t.object({ a: t.number(), b: t.number() }) },
          handler: async ({ params }) => params.a + params.b,
        });

        subtract = $tool({
          description: "Subtract numbers",
          schema: { params: t.object({ a: t.number(), b: t.number() }) },
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
            params: t.object({ a: t.number(), b: t.number() }),
            result: t.number(),
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
          args: t.object({ name: t.text() }),
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
          args: t.object({ name: t.text() }),
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
});
