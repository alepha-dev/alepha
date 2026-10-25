import { Alepha, z } from "alepha";
import { describe, expect, it, test } from "vitest";

import {
  $tool,
  AlephaMcp,
  type McpContext,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("$tool primitive", () => {
  test("should register tool with McpServerProvider", async () => {
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
    const tool = provider.getTool("add");

    expect(tool).toBeDefined();
    expect(tool?.name).toBe("add");
    expect(tool?.description).toBe("Add two numbers");
  });

  test("should use custom name when provided", async () => {
    const alepha = Alepha.create();

    class Tools {
      myTool = $tool({
        name: "custom-tool-name",
        description: "A custom tool",
        handler: async () => "result",
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("custom-tool-name");

    expect(tool).toBeDefined();
    expect(tool?.name).toBe("custom-tool-name");
  });

  test("should execute tool and return result", async () => {
    const alepha = Alepha.create();

    class Calculator {
      multiply = $tool({
        description: "Multiply two numbers",
        schema: {
          params: z.object({
            a: z.number(),
            b: z.number(),
          }),
          result: z.number(),
        },
        handler: async ({ params }) => params.a * params.b,
      });
    }

    alepha.with(AlephaMcp).with(Calculator);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("multiply");

    const result = await tool?.execute({ a: 3, b: 4 });
    expect(result).toBe(12);
  });

  test("should validate params with schema", async () => {
    const alepha = Alepha.create();

    class Tools {
      greet = $tool({
        description: "Greet someone",
        schema: {
          params: z.object({
            name: z.text(),
          }),
          result: z.text(),
        },
        handler: async ({ params }) => `Hello, ${params.name}!`,
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("greet");

    const result = await tool?.execute({ name: "World" });
    expect(result).toBe("Hello, World!");
  });

  test("should throw error for invalid params", async () => {
    const alepha = Alepha.create();

    class Tools {
      typed = $tool({
        description: "Typed tool",
        schema: {
          params: z.object({
            count: z.number(),
          }),
        },
        handler: async ({ params }) => params.count * 2,
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("typed");

    // Pass invalid type - should throw validation error
    await expect(tool?.execute({ count: "not-a-number" })).rejects.toThrow();
  });

  test("should work without schema", async () => {
    const alepha = Alepha.create();

    class Tools {
      simple = $tool({
        description: "Simple tool",
        handler: async () => "done",
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("simple");

    const result = await tool?.execute({});
    expect(result).toBe("done");
  });

  test("should generate correct descriptor", async () => {
    const alepha = Alepha.create();

    class Tools {
      complex = $tool({
        name: "complex-tool",
        description: "A complex tool with params",
        schema: {
          params: z.object({
            required: z.text(),
            optional: z.number().optional(),
          }),
          result: z.boolean(),
        },
        handler: async () => true,
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("complex-tool");
    const descriptor = tool?.toDescriptor();

    expect(descriptor?.name).toBe("complex-tool");
    expect(descriptor?.description).toBe("A complex tool with params");
    expect(descriptor?.inputSchema.type).toBe("object");
    expect(descriptor?.inputSchema.required).toEqual(["required"]);
    expect(descriptor?.inputSchema.properties).toBeDefined();
    expect((descriptor?.inputSchema.properties as any)?.required?.type).toBe(
      "string",
    );
    expect((descriptor?.inputSchema.properties as any)?.optional?.type).toBe(
      "number",
    );
  });

  test("should handle async handlers", async () => {
    const alepha = Alepha.create();

    class Tools {
      async = $tool({
        description: "Async tool",
        schema: {
          params: z.object({
            delay: z.number(),
          }),
          result: z.text(),
        },
        handler: async ({ params }) => {
          await new Promise((resolve) => setTimeout(resolve, params.delay));
          return "completed";
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("async");

    const result = await tool?.execute({ delay: 10 });
    expect(result).toBe("completed");
  });

  test("should handle void result", async () => {
    const alepha = Alepha.create();

    let called = false;

    class Tools {
      void = $tool({
        description: "Void tool",
        handler: async () => {
          called = true;
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("void");

    const result = await tool?.execute({});
    expect(called).toBe(true);
    expect(result).toBeUndefined();
  });

  test("should propagate handler errors", async () => {
    const alepha = Alepha.create();

    class Tools {
      failing = $tool({
        description: "Failing tool",
        handler: async () => {
          throw new Error("Tool failed");
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("failing");

    await expect(tool?.execute({})).rejects.toThrow("Tool failed");
  });

  // -----------------------------------------------------------------------------------------------------------------
  // Context tests
  // -----------------------------------------------------------------------------------------------------------------

  test("should receive context in handler", async () => {
    const alepha = Alepha.create();

    let receivedContext: McpContext | undefined;

    class Tools {
      contextTool = $tool({
        description: "Context tool",
        handler: async ({ context }) => {
          receivedContext = context;
          return "done";
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("contextTool");

    const testContext: McpContext = {
      headers: { authorization: "Bearer test-token" },
    };

    await tool?.execute({}, testContext);

    expect(receivedContext).toBeDefined();
    expect(receivedContext?.headers?.authorization).toBe("Bearer test-token");
  });

  test("should receive context with custom data", async () => {
    const alepha = Alepha.create();

    interface AuthContext {
      userId: string;
      projectId: number;
    }

    let receivedData: AuthContext | undefined;

    class Tools {
      authTool = $tool({
        description: "Authenticated tool",
        handler: async ({ context }) => {
          receivedData = context?.data as AuthContext;
          return `User: ${receivedData?.userId}`;
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("authTool");

    const testContext: McpContext<AuthContext> = {
      headers: {},
      data: { userId: "user-123", projectId: 42 },
    };

    const result = await tool?.execute({}, testContext);

    expect(result).toBe("User: user-123");
    expect(receivedData).toEqual({ userId: "user-123", projectId: 42 });
  });

  test("should work without context", async () => {
    const alepha = Alepha.create();

    let contextWasUndefined = false;

    class Tools {
      noContext = $tool({
        description: "No context tool",
        handler: async ({ context }) => {
          contextWasUndefined = context === undefined;
          return "done";
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("noContext");

    await tool?.execute({});

    expect(contextWasUndefined).toBe(true);
  });

  test("should use context for authentication in handler", async () => {
    const alepha = Alepha.create();

    class Tools {
      protected = $tool({
        description: "Protected tool",
        schema: {
          result: z.text(),
        },
        handler: async ({ context }) => {
          const authHeader = context?.headers?.authorization;
          if (!authHeader?.toString().startsWith("Bearer ")) {
            throw new Error("Unauthorized");
          }
          return "Access granted";
        },
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const tool = provider.getTool("protected");

    // Without auth - should fail
    await expect(tool?.execute({})).rejects.toThrow("Unauthorized");

    // With auth - should succeed
    const result = await tool?.execute(
      {},
      { headers: { authorization: "Bearer valid-token" } },
    );
    expect(result).toBe("Access granted");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("$tool descriptor hygiene", () => {
  /**
   * Collect every `~`-prefixed key reachable from a descriptor. `z.text()`
   * carries its transforms under `~options`, which is Alepha's business and
   * not the client's — it used to ride the wire on every `tools/list`.
   */
  const internalKeys = (node: unknown, path = ""): string[] => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) {
      return node.flatMap((item, i) => internalKeys(item, `${path}/${i}`));
    }
    return Object.entries(node).flatMap(([key, value]) =>
      key.startsWith("~")
        ? [`${path}/${key}`]
        : internalKeys(value, `${path}/${key}`),
    );
  };

  it("emits no internal ~ keys in inputSchema or outputSchema", async () => {
    const alepha = Alepha.create();

    class Tools {
      greet = $tool({
        description: "Greet someone",
        schema: {
          params: z.object({
            who: z.text(),
            aliases: z.array(z.shortText()),
            nested: z.object({ note: z.longText().optional() }),
          }),
          result: z.object({ message: z.text() }),
        },
        handler: async ({ params }) => ({ message: `Hello, ${params.who}!` }),
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const descriptor = alepha
      .inject(McpServerProvider)
      .getTool("greet")
      ?.toDescriptor();

    expect(descriptor?.inputSchema.properties?.who).toMatchObject({
      type: "string",
      maxLength: 255,
    });
    expect(internalKeys(descriptor)).toEqual([]);
  });

  it("keeps a property genuinely named ~options", async () => {
    const alepha = Alepha.create();

    class Tools {
      odd = $tool({
        description: "A tool with an awkward field name",
        schema: {
          params: z.object({ "~options": z.text() }),
        },
        handler: async () => "ok",
      });
    }

    alepha.with(AlephaMcp).with(Tools);
    await alepha.start();

    const descriptor = alepha
      .inject(McpServerProvider)
      .getTool("odd")
      ?.toDescriptor();

    // The strip walks schema NODES; a `properties` map is keyed by user-chosen
    // field names, so filtering it by key would delete a real parameter.
    expect(descriptor?.inputSchema.properties).toHaveProperty("~options");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MCP requires `structuredContent` to be an object. A tool whose declared
 * result is not one - `result: z.number()`, which is what the MCP guide's
 * quick start returns - used to advertise an EMPTY open object and then put
 * the bare number in `structuredContent`, so the envelope matched neither the
 * spec nor its own descriptor.
 */
describe("$tool structured output", () => {
  const boot = async (Tools: new () => object) => {
    const alepha = Alepha.create().with(AlephaMcp).with(Tools);
    await alepha.start();
    const provider = alepha.inject(McpServerProvider);
    const call = async (name: string) =>
      (
        await provider.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        })
      )?.result as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };
    return {
      descriptor: (name: string) => provider.getTool(name)?.toDescriptor(),
      call,
    };
  };

  it("wraps a scalar result under `result`, and says so in the schema", async () => {
    class Tools {
      answer = $tool({
        description: "The answer",
        schema: { result: z.number() },
        handler: async () => 42,
      });
    }

    const { descriptor, call } = await boot(Tools);

    expect(descriptor("answer")?.outputSchema).toMatchObject({
      type: "object",
      properties: { result: { type: "number" } },
      required: ["result"],
    });

    const result = await call("answer");
    expect(result.structuredContent).toEqual({ result: 42 });
    // The text block still carries the bare value, as it always did.
    expect(result.content[0].text).toBe("42");
  });

  it("wraps a union root too", async () => {
    class Tools {
      status = $tool({
        description: "A union",
        schema: {
          result: z.union([z.object({ ok: z.boolean() }), z.text()]),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const { descriptor, call } = await boot(Tools);

    // No `type` at the root of a union's JSON Schema, so it cannot be
    // advertised as the object MCP demands.
    expect(descriptor("status")?.outputSchema).toMatchObject({
      type: "object",
      required: ["result"],
    });

    expect((await call("status")).structuredContent).toEqual({
      result: { ok: true },
    });
  });

  it("leaves an object result exactly as declared", async () => {
    class Tools {
      profile = $tool({
        description: "An object",
        schema: { result: z.object({ name: z.text() }) },
        handler: async () => ({ name: "Ada" }),
      });
    }

    const { descriptor, call } = await boot(Tools);

    // Not wrapped: the declared schema is already the object, so nesting it
    // would break every tool that has one.
    expect(descriptor("profile")?.outputSchema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect((await call("profile")).structuredContent).toEqual({ name: "Ada" });
  });

  it("emits no structuredContent without a result schema", async () => {
    class Tools {
      ping = $tool({
        description: "No result schema",
        handler: async () => "pong",
      });
    }

    const { descriptor, call } = await boot(Tools);

    expect(descriptor("ping")?.outputSchema).toBeUndefined();
    expect((await call("ping")).structuredContent).toBeUndefined();
  });
});
