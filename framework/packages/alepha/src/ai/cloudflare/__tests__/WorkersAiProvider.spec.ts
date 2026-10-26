import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AiConfigError,
  AiOverloadedError,
  AiProvider,
  AiToolsUnsupportedError,
  MemoryAiProvider,
} from "../../core/index.ts";
import {
  AlephaAiCloudflare,
  type WorkersAiBindingApi,
  WorkersAiProvider,
} from "../index.ts";

/**
 * A stand-in for `env.AI`, replaying streams recorded from the real binding's
 * REST twin (`/ai/run/<model>`, the same output), on 2026-10-26.
 */
class RecordedBinding implements WorkersAiBindingApi {
  public runs: Array<{ model: string; inputs: any; options: any }> = [];
  public searches: string[] = [];
  public streams: string[] = [];
  public error?: Error;
  public catalog: Record<string, boolean> = {};

  public async run(model: string, inputs: any, options: any) {
    this.runs.push({ model, inputs, options });
    if (this.error) {
      throw this.error;
    }
    const body = this.streams.shift() ?? "data: [DONE]\n\n";
    return new Response(body).body as ReadableStream<Uint8Array>;
  }

  public async models(params?: { search?: string }) {
    this.searches.push(params?.search ?? "");
    return Object.entries(this.catalog)
      .filter(([name]) => name === params?.search)
      .map(([name, tools]) => ({
        name,
        properties: tools
          ? [{ property_id: "function_calling", value: "true" }]
          : [],
      }));
  }
}

const sse = (...chunks: unknown[]) =>
  [
    ...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");

const SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct";

describe("WorkersAiProvider", () => {
  const setup = async (
    binding: RecordedBinding | null = new RecordedBinding(),
    env: Record<string, string> = {},
  ) => {
    const alepha = Alepha.create({
      env: { ALEPHA_SERVERLESS: "true", AI_MODEL: SCOUT, ...env },
    }).with(AlephaAiCloudflare);
    if (binding) {
      alepha.set("cloudflare.env", { [env.AI_BINDING ?? "AI"]: binding });
    }
    await alepha.start();
    return { alepha, ai: alepha.inject(AiProvider), binding: binding! };
  };

  it("substitutes nothing off Workers, and checks nothing there", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaAiCloudflare);
    // Asked for before start, as a `$ai` field would: `alepha/ai` comes with
    // it, and its default answers.
    const ai = alepha.inject(AiProvider);
    await alepha.start();
    expect(ai).toBeInstanceOf(MemoryAiProvider);
  });

  it("is the AiProvider on Workers, streaming text including a numeric token", async ({
    expect,
  }) => {
    const { ai, binding } = await setup();
    expect(ai).toBeInstanceOf(WorkersAiProvider);
    binding.streams.push(
      sse(
        {
          choices: [
            {
              delta: { content: "", role: "assistant" },
              finish_reason: null,
              index: 0,
            },
          ],
          response: "",
          tool_calls: [],
          usage: { prompt_tokens: 649, completion_tokens: 0 },
        },
        {
          choices: [{ index: 0, delta: { content: "It is " } }],
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          choices: [{ index: 0, delta: { content: 17 } }],
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          choices: [{ index: 0, delta: { content: "°C" } }],
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 649, completion_tokens: 11 },
        },
      ),
    );

    const reply = await ai.complete({
      system: "Be brief.",
      messages: [{ role: "user", content: "Paris?" }],
      maxTokens: 256,
    });

    expect(reply).toEqual({
      text: "It is 17°C",
      toolCalls: [],
      usage: { inputTokens: 649, outputTokens: 11 },
      reason: "stop",
    });
    expect(binding.runs[0].model).toBe(SCOUT);
    expect(binding.runs[0].inputs).toEqual({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Paris?" },
      ],
      stream: true,
      max_tokens: 256,
    });
  });

  it("calls tools on a model with function calling, arguments in fragments", async ({
    expect,
  }) => {
    const { ai, binding } = await setup();
    binding.catalog[SCOUT] = true;
    const toolStream = () =>
      sse(
        {
          choices: [{ delta: { content: "", role: "assistant" }, index: 0 }],
          usage: { prompt_tokens: 624, completion_tokens: 0 },
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: { arguments: '{"city": "', name: "getWeather" },
                    id: "chatcmpl-tool-a78b",
                    index: 0,
                    type: "function",
                  },
                ],
              },
              index: 0,
            },
          ],
          // Workers AI repeats the call at the top level: ignored when
          // `choices` is there.
          tool_calls: [{ arguments: '{"city": "', name: "getWeather" }],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { function: { arguments: 'Paris"}' }, id: null, index: 0 },
                ],
              },
              index: 0,
            },
          ],
        },
        {
          choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
          usage: { prompt_tokens: 624, completion_tokens: 18 },
        },
      );
    binding.streams.push(toolStream(), toolStream());
    const tools = [
      {
        name: "getWeather",
        description: "Temperature",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
      },
    ];

    const reply = await ai.complete({
      messages: [{ role: "user", content: "Paris?" }],
      tools,
    });
    await ai.complete({
      messages: [{ role: "user", content: "Paris?" }],
      tools,
    });

    expect(reply.toolCalls).toEqual([
      {
        id: "chatcmpl-tool-a78b",
        name: "getWeather",
        input: { city: "Paris" },
      },
    ]);
    expect(reply.reason).toBe("tool");
    expect(binding.runs[0].inputs.tools[0].function.name).toBe("getWeather");
    // The catalog is read once per model.
    expect(binding.searches).toEqual([SCOUT]);
  });

  it("reads the older { response, tool_calls } stream", async ({ expect }) => {
    const { ai, binding } = await setup();
    binding.streams.push(
      sse(
        { response: "Hi", usage: { prompt_tokens: 17, completion_tokens: 1 } },
        { response: "", usage: { prompt_tokens: 0, completion_tokens: 1 } },
        { response: "", usage: { prompt_tokens: 17, completion_tokens: 2 } },
      ),
    );
    const reply = await ai.complete({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(reply.text).toBe("Hi");
    expect(reply.usage).toEqual({ inputTokens: 17, outputTokens: 2 });
  });

  it("refuses tools for a model without function calling, with a typed error", async ({
    expect,
  }) => {
    const { ai, binding } = await setup(undefined, {
      AI_MODEL: "@cf/meta/llama-3.2-1b-instruct",
    });
    binding.catalog["@cf/meta/llama-3.2-1b-instruct"] = false;
    await expect(
      ai.complete({
        messages: [{ role: "user", content: "x" }],
        tools: [
          { name: "t", description: "d", inputSchema: { type: "object" } },
        ],
      }),
    ).rejects.toThrow(AiToolsUnsupportedError);
    expect(binding.runs).toEqual([]);
  });

  it("maps a binding failure to a typed error", async ({ expect }) => {
    const { ai, binding } = await setup();
    binding.error = new Error(
      "3040: Capacity temporarily exceeded, please try again.",
    );
    await expect(ai.complete({ messages: [] })).rejects.toThrow(
      AiOverloadedError,
    );
  });

  it("routes through AI Gateway when AI_GATEWAY_ID is set, on a custom binding name", async ({
    expect,
  }) => {
    const { ai, binding } = await setup(undefined, {
      AI_BINDING: "MODELS",
      AI_GATEWAY_ID: "my-gateway",
    });
    await ai.complete({ messages: [] });
    expect(binding.runs[0].options.gateway).toEqual({ id: "my-gateway" });
  });

  it("fails at start on Workers when the binding is missing", async ({
    expect,
  }) => {
    await expect(setup(null)).rejects.toThrow(AiConfigError);
    await expect(setup(null)).rejects.toThrow("binding 'AI' not found");
  });
});

describe("AlephaAiCloudflare beside AlephaAiOpenai", () => {
  const build = async (serverless: boolean) => {
    const { AlephaAiOpenai, OpenAiCompatibleAiProvider } =
      await import("../../openai/index.ts");
    const alepha = Alepha.create({
      env: {
        AI_MODEL: SCOUT,
        ...(serverless ? { ALEPHA_SERVERLESS: "true" } : {}),
      },
    })
      .with(AlephaAiCloudflare)
      .with(AlephaAiOpenai);
    if (serverless) {
      alepha.set("cloudflare.env", { AI: new RecordedBinding() });
    }
    await alepha.start();
    return { ai: alepha.inject(AiProvider), OpenAiCompatibleAiProvider };
  };

  it("answers with the binding on Workers and over REST elsewhere, registered in that order", async ({
    expect,
  }) => {
    const workers = await build(true);
    expect(workers.ai).toBeInstanceOf(WorkersAiProvider);
    const node = await build(false);
    expect(node.ai).toBeInstanceOf(node.OpenAiCompatibleAiProvider);
  });
});
