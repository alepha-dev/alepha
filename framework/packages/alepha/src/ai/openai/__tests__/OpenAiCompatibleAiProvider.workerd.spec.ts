import { describe, it } from "vitest";

import {
  withUpstream,
  withWorkerd,
} from "../../core/__tests__/workerdHarness.ts";

/**
 * The provider's real path on workerd: `fetch` to a local stand-in, the
 * streamed chunks, the SSE reader.
 */
describe("OpenAiCompatibleAiProvider (workerd)", () => {
  it("streams text and a fragmented tool call on workerd", async ({
    expect,
  }) => {
    const chunk = (c: unknown) => `data: ${JSON.stringify(c)}\n\n`;
    await withUpstream(
      () => ({
        body: [
          chunk({ choices: [{ index: 0, delta: { content: "On it" } }] }),
          chunk({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "c1",
                      function: { name: "listInvoices", arguments: '{"qu' },
                    },
                  ],
                },
              },
            ],
          }),
          chunk({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: 'ery":{}}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          chunk({
            choices: [],
            usage: { prompt_tokens: 5, completion_tokens: 6 },
          }),
          "data: [DONE]\n\n",
        ].join(""),
      }),
      async (url, seen) => {
        const result = await withWorkerd(
          {
            name: "ai-openai",
            source: `
import { Alepha } from "alepha";
import { AiProvider } from "alepha/ai";
import { AlephaAiOpenai } from "alepha/ai/openai";
export default { async fetch(request) {
 const input = await request.json();
 const app = Alepha.create({ env: { AI_MODEL: "m", AI_API_KEY: "k", AI_BASE_URL: input.base + "/v1" } }).with(AlephaAiOpenai);
 await app.start();
 return Response.json(await app.inject(AiProvider).complete({ messages: [{ role: "user", content: "hi" }], tools: [{ name: "listInvoices", description: "d", inputSchema: { type: "object" } }] }));
} };
`,
          },
          async (dispatch) => (await dispatch({ base: url })).json(),
        );

        expect(result).toEqual({
          text: "On it",
          toolCalls: [{ id: "c1", name: "listInvoices", input: { query: {} } }],
          usage: { inputTokens: 5, outputTokens: 6 },
          reason: "tool",
        });
        expect(seen[0].url).toBe("/v1/chat/completions");
        expect(seen[0].headers.authorization).toBe("Bearer k");
      },
    );
  }, 60_000);
});
