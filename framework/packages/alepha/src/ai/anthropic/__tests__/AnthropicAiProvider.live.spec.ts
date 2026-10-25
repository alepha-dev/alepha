import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AiProvider, type AiMessage } from "../../core/index.ts";
import { AlephaAiAnthropic } from "../index.ts";

/**
 * Against the real Messages API, because a recorded fixture cannot disagree
 * with the code that was written from it. Skipped without `AI_API_KEY`;
 * `AI_MODEL` picks the model.
 */
describe.skipIf(!process.env.AI_API_KEY)("AnthropicAiProvider (live)", () => {
  it("answers, calls a tool, and reads its result back", async ({ expect }) => {
    const alepha = Alepha.create({
      env: {
        AI_API_KEY: process.env.AI_API_KEY,
        AI_MODEL: process.env.AI_MODEL || "claude-opus-5-5",
        AI_BASE_URL: process.env.AI_BASE_URL,
      },
    }).with(AlephaAiAnthropic);
    await alepha.start();
    const ai = alepha.inject(AiProvider);
    const tools = [
      {
        name: "getWeather",
        description: "Current temperature in Celsius for a city",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
    const messages: AiMessage[] = [
      {
        role: "user",
        content: "What is the temperature in Paris? Use the tool.",
      },
    ];

    const first = await ai.complete({ system: "Be brief.", messages, tools });
    expect(first.reason).toBe("tool");
    expect(first.toolCalls[0].name).toBe("getWeather");
    expect(first.usage.inputTokens).toBeGreaterThan(0);

    messages.push(
      {
        role: "assistant",
        content: first.text,
        toolCalls: first.toolCalls,
        vendor: first.vendor,
      },
      {
        role: "tool",
        callId: first.toolCalls[0].id,
        name: "getWeather",
        content: '{"celsius": 17}',
      },
    );
    const second = await ai.complete({ system: "Be brief.", messages, tools });
    expect(second.reason).toBe("stop");
    expect(second.text).toContain("17");
  }, 120_000);
});
