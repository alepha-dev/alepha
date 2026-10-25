import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { type AiMessage, AiProvider } from "../../core/index.ts";
import { AlephaAiOpenai } from "../index.ts";

/**
 * Against a real compatible endpoint, because a recorded fixture cannot
 * disagree with the code written from it. Skipped unless
 * `AI_LIVE_OPENAI_BASE_URL` and `AI_LIVE_OPENAI_MODEL` are set
 * (`AI_LIVE_OPENAI_API_KEY` too, for an endpoint that needs one):
 *
 * - local Ollama: `http://localhost:11434/v1`, a tool-capable model such as
 *   `qwen2.5:0.5b`;
 * - Workers AI over REST:
 *   `https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1`, a
 *   function-calling model, an API token with Workers AI read.
 */
describe.skipIf(
  !process.env.AI_LIVE_OPENAI_BASE_URL || !process.env.AI_LIVE_OPENAI_MODEL,
)("OpenAiCompatibleAiProvider (live)", () => {
  it("answers, calls a tool, and reads its result back", async ({ expect }) => {
    const alepha = Alepha.create({
      env: {
        AI_BASE_URL: process.env.AI_LIVE_OPENAI_BASE_URL,
        AI_MODEL: process.env.AI_LIVE_OPENAI_MODEL,
        AI_API_KEY: process.env.AI_LIVE_OPENAI_API_KEY ?? "",
      },
    }).with(AlephaAiOpenai);
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
        content: "What is the temperature in Paris? Call the getWeather tool.",
      },
    ];

    const first = await ai.complete({ messages, tools });
    expect(first.reason).toBe("tool");
    expect(first.toolCalls[0].name).toBe("getWeather");
    expect(first.usage.inputTokens).toBeGreaterThan(0);

    messages.push(
      { role: "assistant", content: first.text, toolCalls: first.toolCalls },
      {
        role: "tool",
        callId: first.toolCalls[0].id,
        name: "getWeather",
        content: '{"celsius": 17}',
      },
    );
    const second = await ai.complete({ messages, tools });
    expect(second.reason).toBe("stop");
    expect(second.text).toContain("17");
  }, 120_000);
});
