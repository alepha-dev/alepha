import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AiProvider, AlephaAi, MemoryAiProvider } from "../index.ts";

describe("MemoryAiProvider", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaAi);
    await alepha.start();
    return {
      alepha,
      ai: alepha.inject(AiProvider),
      memory: alepha.inject(MemoryAiProvider),
    };
  };

  it("is the AiProvider when no vendor module is registered", async ({
    expect,
  }) => {
    const { ai, memory } = await setup();
    expect(ai).toBe(memory);
  });

  it("plays scripted text replies in order", async ({ expect }) => {
    const { ai, memory } = await setup();
    memory.script([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", inputTokens: 12, outputTokens: 3 },
    ]);
    memory.script([{ type: "text", text: "Second" }]);

    const first = await ai.complete({
      messages: [{ role: "user", content: "hi" }],
    });
    const second = await ai.complete({
      messages: [{ role: "user", content: "again" }],
    });

    expect(first).toEqual({
      text: "Hello",
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 3 },
      reason: "stop",
    });
    expect(second.text).toBe("Second");
    expect(memory.pending).toBe(0);
    expect(memory.requests.map((r) => r.messages[0].content)).toEqual([
      "hi",
      "again",
    ]);
  });

  it("streams tool calls and ends with reason tool", async ({ expect }) => {
    const { ai, memory } = await setup();
    memory.script([
      {
        type: "tool_call",
        id: "call_1",
        name: "listInvoices",
        input: { query: { status: "open" } },
      },
    ]);

    const events = [];
    for await (const event of ai.chat({
      messages: [{ role: "user", content: "open invoices?" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "listInvoices",
        input: { query: { status: "open" } },
      },
      { type: "end", reason: "tool" },
    ]);
  });

  it("stops at a scripted end event", async ({ expect }) => {
    const { ai, memory } = await setup();
    memory.script([
      { type: "text", text: "cut" },
      { type: "end", reason: "length" },
      { type: "text", text: "never" },
    ]);
    const reply = await ai.complete({ messages: [] });
    expect(reply.text).toBe("cut");
    expect(reply.reason).toBe("length");
  });

  it("answers unscripted with a reply naming the missing vendor module", async ({
    expect,
  }) => {
    const { ai } = await setup();
    const reply = await ai.complete({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(reply.reason).toBe("stop");
    expect(reply.text).toContain("No AI vendor module is registered");
    expect(reply.text).toContain("AlephaAiCloudflare");
    expect(reply.text).toContain("AlephaAiAnthropic");
  });

  it("cancels an in-flight stream when the signal aborts", async ({
    expect,
  }) => {
    const { ai, memory } = await setup();
    memory.script([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
      { type: "text", text: "three" },
    ]);
    const controller = new AbortController();
    const seen: string[] = [];

    await expect(
      (async () => {
        for await (const event of ai.chat({
          messages: [],
          signal: controller.signal,
        })) {
          if (event.type === "text") {
            seen.push(event.text);
            controller.abort(new Error("stop"));
          }
        }
      })(),
    ).rejects.toThrow("stop");
    expect(seen).toEqual(["one"]);
  });

  it("follows the ambient context signal when the request has none", async ({
    expect,
  }) => {
    const { alepha, ai, memory } = await setup();
    memory.script([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ]);
    const controller = new AbortController();
    const seen: string[] = [];

    await expect(
      alepha.context.run(
        async () => {
          for await (const event of ai.chat({ messages: [] })) {
            if (event.type === "text") {
              seen.push(event.text);
              controller.abort(new Error("ambient"));
            }
          }
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("ambient");
    expect(seen).toEqual(["one"]);
  });

  it("resolves the model from the request, else AI_MODEL, else throws", async ({
    expect,
  }) => {
    const { memory } = await setup();
    expect(memory.resolveModel({ model: "m-1" })).toBe("m-1");
    expect(() => memory.resolveModel({})).toThrow("set AI_MODEL");

    const alepha = Alepha.create({ env: { AI_MODEL: "env-model" } }).with(
      AlephaAi,
    );
    await alepha.start();
    expect(alepha.inject(MemoryAiProvider).resolveModel({})).toBe("env-model");
  });
});
