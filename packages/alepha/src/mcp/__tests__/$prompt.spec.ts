import { Alepha, z } from "alepha";
import { describe, expect, test } from "vitest";

import {
  $prompt,
  AlephaMcp,
  type McpContext,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("$prompt primitive", () => {
  test("should register prompt with McpServerProvider", async () => {
    const alepha = Alepha.create();

    class Prompts {
      greeting = $prompt({
        description: "Generate a greeting",
        args: z.object({
          name: z.text(),
        }),
        handler: async ({ args }) => [
          { role: "user", content: `Say hello to ${args.name}` },
        ],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("greeting");

    expect(prompt).toBeDefined();
    expect(prompt?.name).toBe("greeting");
    expect(prompt?.description).toBe("Generate a greeting");
  });

  test("should use custom name when provided", async () => {
    const alepha = Alepha.create();

    class Prompts {
      myPrompt = $prompt({
        name: "custom-prompt",
        description: "A custom prompt",
        handler: async () => [{ role: "user", content: "Hello" }],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("custom-prompt");

    expect(prompt).toBeDefined();
    expect(prompt?.name).toBe("custom-prompt");
  });

  test("should execute prompt and return messages", async () => {
    const alepha = Alepha.create();

    class Prompts {
      review = $prompt({
        description: "Request a code review",
        args: z.object({
          code: z.text(),
          language: z.text(),
        }),
        handler: async ({ args }) => [
          {
            role: "user",
            content: `Please review this ${args.language} code:\n\n${args.code}`,
          },
        ],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("review");

    const messages = await prompt?.get({
      code: "console.log('hello')",
      language: "JavaScript",
    });

    expect(messages).toHaveLength(1);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[0].content).toContain("JavaScript");
    expect(messages?.[0].content).toContain("console.log");
  });

  test("should validate args with schema", async () => {
    const alepha = Alepha.create();

    class Prompts {
      typed = $prompt({
        description: "Typed prompt",
        args: z.object({
          name: z.text(),
          count: z.number(),
        }),
        handler: async ({ args }) => [
          {
            role: "user",
            content: `Hello ${args.name}, count is ${args.count}`,
          },
        ],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("typed");

    const messages = await prompt?.get({ name: "World", count: 42 });
    expect(messages?.[0].content).toContain("World");
    expect(messages?.[0].content).toContain("42");
  });

  test("should throw error for invalid args", async () => {
    const alepha = Alepha.create();

    class Prompts {
      validated = $prompt({
        description: "Validated prompt",
        args: z.object({
          required: z.text(),
        }),
        handler: async ({ args }) => [{ role: "user", content: args.required }],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("validated");

    // Missing required arg
    await expect(prompt?.get({})).rejects.toThrow();
  });

  test("should work without args schema", async () => {
    const alepha = Alepha.create();

    class Prompts {
      simple = $prompt({
        description: "Simple prompt",
        handler: async () => [{ role: "user", content: "Simple message" }],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("simple");

    const messages = await prompt?.get({});
    expect(messages?.[0].content).toBe("Simple message");
  });

  test("should support multi-turn conversations", async () => {
    const alepha = Alepha.create();

    class Prompts {
      conversation = $prompt({
        description: "Multi-turn prompt",
        args: z.object({
          topic: z.text(),
        }),
        handler: async ({ args }) => [
          { role: "user", content: `Let's discuss ${args.topic}` },
          {
            role: "assistant",
            content: `I'd be happy to discuss ${args.topic}. What would you like to know?`,
          },
          { role: "user", content: "Tell me more about it." },
        ],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("conversation");

    const messages = await prompt?.get({ topic: "AI" });
    expect(messages).toHaveLength(3);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[1].role).toBe("assistant");
    expect(messages?.[2].role).toBe("user");
  });

  test("should generate correct descriptor", async () => {
    const alepha = Alepha.create();

    class Prompts {
      complex = $prompt({
        name: "complex-prompt",
        description: "A complex prompt with args",
        args: z.object({
          required: z.text({ description: "A required argument" }),
          optional: z.number().describe("An optional argument").optional(),
        }),
        handler: async () => [{ role: "user", content: "test" }],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("complex-prompt");
    const descriptor = prompt?.toDescriptor();

    expect(descriptor?.name).toBe("complex-prompt");
    expect(descriptor?.description).toBe("A complex prompt with args");
    expect(descriptor?.arguments).toHaveLength(2);
    expect(descriptor?.arguments?.[0]).toEqual({
      name: "required",
      description: "A required argument",
      required: true,
    });
    expect(descriptor?.arguments?.[1]).toEqual({
      name: "optional",
      description: "An optional argument",
      required: false,
    });
  });

  test("should handle async handlers", async () => {
    const alepha = Alepha.create();

    class Prompts {
      async = $prompt({
        description: "Async prompt",
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return [{ role: "user", content: "Async content" }];
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("async");

    const messages = await prompt?.get({});
    expect(messages?.[0].content).toBe("Async content");
  });

  test("should propagate handler errors", async () => {
    const alepha = Alepha.create();

    class Prompts {
      failing = $prompt({
        description: "Failing prompt",
        handler: async () => {
          throw new Error("Prompt generation failed");
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("failing");

    await expect(prompt?.get({})).rejects.toThrow("Prompt generation failed");
  });

  test("should handle optional args", async () => {
    const alepha = Alepha.create();

    class Prompts {
      optional = $prompt({
        description: "Prompt with optional args",
        args: z.object({
          name: z.text(),
          style: z.enum(["formal", "casual"]).optional(),
        }),
        handler: async ({ args }) => [
          {
            role: "user",
            content:
              args.style === "formal"
                ? `Good day, ${args.name}.`
                : `Hey ${args.name}!`,
          },
        ],
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("optional");

    // Without optional arg (defaults to casual-like)
    const messages1 = await prompt?.get({ name: "Alice" });
    expect(messages1?.[0].content).toContain("Alice");

    // With formal style
    const messages2 = await prompt?.get({ name: "Bob", style: "formal" });
    expect(messages2?.[0].content).toBe("Good day, Bob.");
  });

  // -----------------------------------------------------------------------------------------------------------------
  // Context tests
  // -----------------------------------------------------------------------------------------------------------------

  test("should receive context in handler", async () => {
    const alepha = Alepha.create();

    let receivedContext: McpContext | undefined;

    class Prompts {
      contextPrompt = $prompt({
        description: "Context prompt",
        handler: async ({ context }) => {
          receivedContext = context;
          return [{ role: "user", content: "test" }];
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("contextPrompt");

    const testContext: McpContext = {
      headers: { authorization: "Bearer test-token" },
    };

    await prompt?.get({}, testContext);

    expect(receivedContext).toBeDefined();
    expect(receivedContext?.headers?.authorization).toBe("Bearer test-token");
  });

  test("should receive context with custom data", async () => {
    const alepha = Alepha.create();

    interface UserContext {
      userId: string;
      userName: string;
    }

    let receivedData: UserContext | undefined;

    class Prompts {
      userPrompt = $prompt({
        description: "User-specific prompt",
        handler: async ({ context }) => {
          receivedData = context?.data as UserContext;
          return [
            {
              role: "user",
              content: `Hello, I am ${receivedData?.userName}`,
            },
          ];
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("userPrompt");

    const testContext: McpContext<UserContext> = {
      headers: {},
      data: { userId: "user-789", userName: "Alice" },
    };

    const messages = await prompt?.get({}, testContext);

    expect(messages?.[0].content).toBe("Hello, I am Alice");
    expect(receivedData).toEqual({ userId: "user-789", userName: "Alice" });
  });

  test("should work without context", async () => {
    const alepha = Alepha.create();

    let contextWasUndefined = false;

    class Prompts {
      noContext = $prompt({
        description: "No context prompt",
        handler: async ({ context }) => {
          contextWasUndefined = context === undefined;
          return [{ role: "user", content: "done" }];
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("noContext");

    await prompt?.get({});

    expect(contextWasUndefined).toBe(true);
  });

  test("should use context for personalization", async () => {
    const alepha = Alepha.create();

    interface AuthContext {
      role: "admin" | "user";
    }

    class Prompts {
      rolePrompt = $prompt({
        description: "Role-based prompt",
        args: z.object({
          task: z.text(),
        }),
        handler: async ({ args, context }) => {
          const authContext = context?.data as AuthContext | undefined;
          const rolePrefix =
            authContext?.role === "admin"
              ? "As an administrator, "
              : "As a user, ";
          return [{ role: "user", content: `${rolePrefix}${args.task}` }];
        },
      });
    }

    alepha.with(AlephaMcp).with(Prompts);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const prompt = provider.getPrompt("rolePrompt");

    // Without context - default user behavior
    const messages1 = await prompt?.get({ task: "help me" });
    expect(messages1?.[0].content).toBe("As a user, help me");

    // With admin context
    const messages2 = await prompt?.get(
      { task: "delete everything" },
      { headers: {}, data: { role: "admin" } },
    );
    expect(messages2?.[0].content).toBe(
      "As an administrator, delete everything",
    );
  });
});
