import { Alepha, z } from "alepha";
import { describe, expect, test } from "vitest";

import {
  $prompt,
  $resource,
  $tool,
  AlephaMcp,
  MCP_PROTOCOL_VERSION,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("MCP Integration", () => {
  test("full workflow: initialize, list tools, call tool", async () => {
    const alepha = Alepha.create();

    class Calculator {
      add = $tool({
        description: "Add two numbers",
        schema: {
          params: z.object({
            a: z.number(),
            b: z.number(),
          }),
          result: z.number(),
        },
        handler: async ({ params }) => params.a + params.b,
      });
    }

    alepha.with(AlephaMcp).with(Calculator);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);

    // Step 1: Initialize
    const initResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    expect(initResponse?.result).toBeDefined();
    const initResult = initResponse!.result as {
      capabilities: { tools?: object };
    };
    expect(initResult.capabilities.tools).toBeDefined();

    // Step 2: Send initialized notification
    const notifResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notifResponse).toBeNull();

    // Step 3: List tools
    const listResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    const tools = (listResponse!.result as { tools: Array<{ name: string }> })
      .tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("add");

    // Step 4: Call tool
    const callResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "add",
        arguments: { a: 10, b: 20 },
      },
    });

    const result = callResponse!.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe("30");
  });

  test("full workflow: initialize, list resources, read resource", async () => {
    const alepha = Alepha.create();

    let readCount = 0;

    class Files {
      readme = $resource({
        uri: "file:///README.md",
        name: "README",
        description: "Project readme file",
        mimeType: "text/markdown",
        handler: async () => {
          readCount++;
          return { text: `# Project\n\nRead count: ${readCount}` };
        },
      });
    }

    alepha.with(AlephaMcp).with(Files);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);

    // Initialize
    await provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    // List resources
    const listResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
    });

    const resources = (
      listResponse!.result as {
        resources: Array<{ uri: string; name: string }>;
      }
    ).resources;
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe("file:///README.md");
    expect(resources[0].name).toBe("README");

    // Read resource twice
    const read1 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "file:///README.md" },
    });

    const content1 = (read1!.result as { contents: Array<{ text: string }> })
      .contents[0];
    expect(content1.text).toContain("Read count: 1");

    const read2 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "file:///README.md" },
    });

    const content2 = (read2!.result as { contents: Array<{ text: string }> })
      .contents[0];
    expect(content2.text).toContain("Read count: 2");
  });

  test("full workflow: initialize, list prompts, get prompt", async () => {
    const alepha = Alepha.create();

    class Prompts {
      codeReview = $prompt({
        name: "code-review",
        description: "Request a code review for the given code",
        args: z.object({
          language: z.text({ description: "Programming language" }),
          code: z.text({ description: "Code to review" }),
          focus: z.text({ description: "Focus areas for review" }).optional(),
        }),
        handler: async ({ args }) => {
          const messages = [
            {
              role: "user" as const,
              content: `Please review this ${args.language} code:\n\n\`\`\`${args.language}\n${args.code}\n\`\`\``,
            },
          ];

          if (args.focus) {
            messages.push({
              role: "user" as const,
              content: `Please focus on: ${args.focus}`,
            });
          }

          return messages;
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);

    // Initialize
    await provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    // List prompts
    const listResponse = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/list",
    });

    const prompts = (
      listResponse!.result as {
        prompts: Array<{
          name: string;
          arguments?: Array<{ name: string; required?: boolean }>;
        }>;
      }
    ).prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe("code-review");
    expect(prompts[0].arguments).toHaveLength(3);

    // Get prompt without optional arg
    const get1 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: {
        name: "code-review",
        arguments: {
          language: "TypeScript",
          code: "const x = 1;",
        },
      },
    });

    const messages1 = (
      get1!.result as {
        messages: Array<{ role: string; content: { text: string } }>;
      }
    ).messages;
    expect(messages1).toHaveLength(1);
    expect(messages1[0].content.text).toContain("TypeScript");

    // Get prompt with optional arg
    const get2 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "prompts/get",
      params: {
        name: "code-review",
        arguments: {
          language: "JavaScript",
          code: "let y = 2;",
          focus: "performance",
        },
      },
    });

    const messages2 = (
      get2!.result as { messages: Array<{ content: { text: string } }> }
    ).messages;
    expect(messages2).toHaveLength(2);
    expect(messages2[1].content.text).toContain("performance");
  });

  test("combined server with all capabilities", async () => {
    const alepha = Alepha.create();

    class MyMcpServer {
      // Tools
      calculator = $tool({
        description: "Basic calculator",
        schema: {
          params: z.object({
            op: z.enum(["add", "sub", "mul", "div"]),
            a: z.number(),
            b: z.number(),
          }),
          result: z.number(),
        },
        handler: async ({ params }) => {
          switch (params.op) {
            case "add":
              return params.a + params.b;
            case "sub":
              return params.a - params.b;
            case "mul":
              return params.a * params.b;
            case "div":
              return params.a / params.b;
          }
        },
      });

      echo = $tool({
        description: "Echo the input",
        schema: {
          params: z.object({ message: z.text() }),
          result: z.text(),
        },
        handler: async ({ params }) => params.message,
      });

      // Resources
      version = $resource({
        uri: "app://version",
        name: "Version",
        mimeType: "application/json",
        handler: async () => ({
          text: JSON.stringify({ version: "1.0.0", build: "123" }),
        }),
      });

      // Prompts
      greeting = $prompt({
        description: "Generate a greeting",
        args: z.object({ name: z.text() }),
        handler: async ({ args }) => [
          { role: "user", content: `Say hello to ${args.name}` },
        ],
      });
    }

    alepha.with(AlephaMcp).with(MyMcpServer);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);

    // Check all capabilities
    const init = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    const caps = (
      init!.result as {
        capabilities: { tools?: object; resources?: object; prompts?: object };
      }
    ).capabilities;
    expect(caps.tools).toBeDefined();
    expect(caps.resources).toBeDefined();
    expect(caps.prompts).toBeDefined();

    // Use calculator tool
    const calc = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "calculator", arguments: { op: "mul", a: 7, b: 8 } },
    });
    expect(
      (calc!.result as { content: Array<{ text: string }> }).content[0].text,
    ).toBe("56");

    // Read version resource
    const ver = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "app://version" },
    });
    const versionData = JSON.parse(
      (ver!.result as { contents: Array<{ text: string }> }).contents[0].text,
    );
    expect(versionData.version).toBe("1.0.0");

    // Get greeting prompt
    const greet = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "prompts/get",
      params: { name: "greeting", arguments: { name: "Alice" } },
    });
    expect(
      (greet!.result as { messages: Array<{ content: { text: string } }> })
        .messages[0].content.text,
    ).toContain("Alice");
  });

  test("error handling across multiple requests", async () => {
    const alepha = Alepha.create();

    let callCount = 0;

    class Tools {
      flaky = $tool({
        description: "Fails every other call",
        handler: async () => {
          callCount++;
          if (callCount % 2 === 0) {
            throw new Error("Flaky failure");
          }
          return "success";
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);

    // First call - success
    const r1 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "flaky", arguments: {} },
    });
    expect(
      (r1!.result as { content: Array<{ text: string }> }).content[0].text,
    ).toBe("success");

    // Second call - failure
    const r2 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "flaky", arguments: {} },
    });
    expect((r2!.result as { isError?: boolean }).isError).toBe(true);

    // Third call - success (server should still work)
    const r3 = await provider.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "flaky", arguments: {} },
    });
    expect(
      (r3!.result as { content: Array<{ text: string }> }).content[0].text,
    ).toBe("success");
  });
});
