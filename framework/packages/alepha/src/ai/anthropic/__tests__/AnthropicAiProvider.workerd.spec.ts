import { describe, it } from "vitest";

import {
  withUpstream,
  withWorkerd,
} from "../../core/__tests__/workerdHarness.ts";

/**
 * The provider's real path on workerd: `fetch` to the vendor (a local
 * stand-in through `AI_BASE_URL`), the streamed body, the SSE reader.
 */
describe("AnthropicAiProvider (workerd)", () => {
  it("streams a reply and a tool call on workerd", async ({ expect }) => {
    const events = (...list: Array<Record<string, unknown>>) =>
      list
        .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
        .join("");

    await withUpstream(
      () => ({
        body: events(
          { type: "message_start", message: { usage: { input_tokens: 9 } } },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Looking" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: {
              type: "tool_use",
              id: "t1",
              name: "listInvoices",
              input: {},
            },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"query":{}}' },
          },
          { type: "content_block_stop", index: 1 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 4 },
          },
          { type: "message_stop" },
        ),
      }),
      async (url, seen) => {
        const result = await withWorkerd(
          {
            name: "ai-anthropic",
            source: `
import { Alepha } from "alepha";
import { AiProvider } from "alepha/ai";
import { AlephaAiAnthropic } from "alepha/ai/anthropic";
export default { async fetch(request) {
 const input = await request.json();
 const app = Alepha.create({ env: { AI_API_KEY: "sk-workerd", AI_MODEL: "claude-test", AI_BASE_URL: input.base } }).with(AlephaAiAnthropic);
 await app.start();
 const reply = await app.inject(AiProvider).complete({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [{ name: "listInvoices", description: "d", inputSchema: { type: "object" } }] });
 return Response.json(reply);
} };
`,
          },
          async (dispatch) => (await dispatch({ base: url })).json(),
        );

        expect(result).toEqual({
          text: "Looking",
          toolCalls: [{ id: "t1", name: "listInvoices", input: { query: {} } }],
          usage: { inputTokens: 9, outputTokens: 4 },
          reason: "tool",
        });
        expect(seen[0].url).toBe("/v1/messages");
        expect(seen[0].headers["x-api-key"]).toBe("sk-workerd");
        expect(seen[0].body.system[0].cache_control).toEqual({
          type: "ephemeral",
        });
      },
    );
  }, 60_000);
});
