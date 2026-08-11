import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import {
  $prompt,
  $resource,
  $resourceTemplate,
  $tool,
  AlephaMcp,
  type McpContent,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("prompt message content", () => {
  const get = async (alepha: Alepha, name: string) =>
    alepha.inject(McpServerProvider).handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name },
    });

  it("wraps a plain string into a text block", async () => {
    class Prompts {
      greeting = $prompt({
        handler: async () => [{ role: "user" as const, content: "hello" }],
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Prompts);
    await alepha.start();

    const result = (await get(alepha, "greeting"))?.result as {
      messages: Array<{ role: string; content: McpContent }>;
    };

    expect(result.messages).toEqual([
      { role: "user", content: { type: "text", text: "hello" } },
    ]);
  });

  /**
   * `PromptMessage.content` was typed `string` and the server hard-coded every
   * message to a text block, so a prompt could never return an image — even
   * though the content types said it could.
   */
  it("passes a single content block through verbatim", async () => {
    class Prompts {
      shot = $prompt({
        handler: async () => [
          {
            role: "user" as const,
            content: {
              type: "image" as const,
              data: "aGVsbG8=",
              mimeType: "image/png",
            },
          },
        ],
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Prompts);
    await alepha.start();

    const result = (await get(alepha, "shot"))?.result as {
      messages: Array<{ role: string; content: McpContent }>;
    };

    expect(result.messages[0].content).toEqual({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    });
  });

  /**
   * On the wire a message carries exactly one block, so several blocks become
   * several messages — in order, all keeping the original role.
   */
  it("expands an array of blocks into one message per block", async () => {
    class Prompts {
      mixed = $prompt({
        handler: async () => [
          {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: "Look:" },
              {
                type: "resource_link" as const,
                uri: "folio://1/86",
                name: "folio",
              },
            ],
          },
        ],
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Prompts);
    await alepha.start();

    const result = (await get(alepha, "mixed"))?.result as {
      messages: Array<{ role: string; content: McpContent }>;
    };

    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m) => m.role === "assistant")).toBe(true);
    expect(result.messages[0].content).toEqual({
      type: "text",
      text: "Look:",
    });
    expect(result.messages[1].content).toMatchObject({
      type: "resource_link",
      uri: "folio://1/86",
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("descriptor annotations and _meta", () => {
  class Everything {
    tool = $tool({
      description: "A tool",
      _meta: { "app/group": "admin" },
      handler: async () => "ok",
    });

    doc = $resource({
      uri: "app://doc",
      annotations: {
        audience: ["user" as const],
        priority: 0.8,
        lastModified: "2026-08-11T00:00:00.000Z",
      },
      _meta: { "app/source": "cms" },
      handler: async () => ({ text: "" }),
    });

    folio = $resourceTemplate({
      uriTemplate: "folio://{id}",
      annotations: { priority: 0.3 },
      _meta: { "app/source": "lore" },
      variables: z.object({ id: z.text() }),
      handler: async () => ({ text: "" }),
    });

    prompt = $prompt({
      _meta: { "app/group": "writing" },
      handler: async () => [],
    });
  }

  const start = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(Everything);
    await alepha.start();
    return alepha.inject(McpServerProvider);
  };

  it("carries lastModified on a resource, so a client can skip a re-read", async () => {
    const provider = await start();

    expect(provider.getResource("app://doc")?.toDescriptor()).toMatchObject({
      annotations: {
        audience: ["user"],
        priority: 0.8,
        lastModified: "2026-08-11T00:00:00.000Z",
      },
    });
  });

  it("carries annotations on a resource template", async () => {
    const provider = await start();

    expect(
      provider.getResourceTemplates()[0].toDescriptor().annotations,
    ).toEqual({ priority: 0.3 });
  });

  /**
   * `_meta` was declared on all three descriptors but settable on none, so it
   * was always absent — a field nothing can fill is a false affordance.
   */
  it("emits _meta on tool, resource, template and prompt descriptors", async () => {
    const provider = await start();

    expect(provider.getTool("tool")?.toDescriptor()._meta).toEqual({
      "app/group": "admin",
    });
    expect(provider.getResource("app://doc")?.toDescriptor()._meta).toEqual({
      "app/source": "cms",
    });
    expect(provider.getResourceTemplates()[0].toDescriptor()._meta).toEqual({
      "app/source": "lore",
    });
    expect(provider.getPrompt("prompt")?.toDescriptor()._meta).toEqual({
      "app/group": "writing",
    });
  });

  it("omits _meta and annotations when not set", async () => {
    class Plain {
      tool = $tool({ description: "x", handler: async () => "ok" });
      doc = $resource({ uri: "app://x", handler: async () => ({ text: "" }) });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Plain);
    await alepha.start();
    const provider = alepha.inject(McpServerProvider);

    expect(provider.getTool("tool")?.toDescriptor()).not.toHaveProperty(
      "_meta",
    );
    expect(provider.getResource("app://x")?.toDescriptor()).not.toHaveProperty(
      "annotations",
    );
  });
});
