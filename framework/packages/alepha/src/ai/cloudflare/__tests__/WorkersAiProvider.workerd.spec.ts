import { describe, it } from "vitest";

import { withWorkerd } from "../../core/__tests__/workerdHarness.ts";

/**
 * On workerd, with the `Cloudflare` global that makes `isServerless()` true:
 * the module substitutes the provider, which streams from a binding. The
 * binding is a stand-in, since Miniflare only offers Workers AI through a
 * remote proxy; the real one is proven on a deployed worker (#Q2771).
 */
describe("WorkersAiProvider (workerd)", () => {
  it("is the AiProvider on workerd and streams from the binding", async ({
    expect,
  }) => {
    const result = await withWorkerd(
      {
        name: "ai-workers",
        source: `
import { Alepha } from "alepha";
import { AiProvider } from "alepha/ai";
import { AlephaAiCloudflare, WorkersAiProvider } from "alepha/ai/cloudflare";
const chunk = (c) => "data: " + JSON.stringify(c) + "\\n\\n";
const seen = [];
const AI = {
 run: async (model, inputs) => {
  seen.push({ model, stream: inputs.stream, tools: inputs.tools?.length ?? 0 });
  return new Response(
   chunk({ choices: [{ index: 0, delta: { content: "Hi " } }] }) +
   chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "listInvoices", arguments: { query: {} } } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }) +
   "data: [DONE]\\n\\n",
  ).body;
 },
 models: async () => [{ name: "@cf/x", properties: [{ property_id: "function_calling", value: "true" }] }],
};
export default { async fetch() {
 const app = Alepha.create({ env: { AI_MODEL: "@cf/x" } }).with(AlephaAiCloudflare);
 app.set("cloudflare.env", { AI });
 await app.start();
 const ai = app.inject(AiProvider);
 const reply = await ai.complete({ messages: [{ role: "user", content: "hi" }], tools: [{ name: "listInvoices", description: "d", inputSchema: { type: "object" } }] });
 return Response.json({ isWorkers: ai instanceof WorkersAiProvider, reply, seen });
} };
`,
      },
      async (dispatch) => (await dispatch({})).json(),
    );

    expect(result).toEqual({
      isWorkers: true,
      reply: {
        text: "Hi ",
        toolCalls: [{ id: "t1", name: "listInvoices", input: { query: {} } }],
        usage: { inputTokens: 3, outputTokens: 4 },
        reason: "tool",
      },
      seen: [{ model: "@cf/x", stream: true, tools: 1 }],
    });
  }, 60_000);
});
