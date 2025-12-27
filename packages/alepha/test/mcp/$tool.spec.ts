import { Alepha, t } from "alepha";
import { $tool, AlephaMcp, McpServerProvider } from "alepha/mcp";
import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------------------------------------------------

describe("$tool primitive", () => {
  test("should register tool with McpServerProvider", async () => {
    const alepha = Alepha.create();

    class Calculator {
      add = $tool({
        description: "Add two numbers",
        schema: {
          params: t.object({
            a: t.number(),
            b: t.number(),
          }),
          result: t.number(),
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
          params: t.object({
            a: t.number(),
            b: t.number(),
          }),
          result: t.number(),
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
          params: t.object({
            name: t.text(),
          }),
          result: t.text(),
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
          params: t.object({
            count: t.number(),
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
          params: t.object({
            required: t.text(),
            optional: t.optional(t.number()),
          }),
          result: t.boolean(),
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
          params: t.object({
            delay: t.number(),
          }),
          result: t.text(),
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
});
