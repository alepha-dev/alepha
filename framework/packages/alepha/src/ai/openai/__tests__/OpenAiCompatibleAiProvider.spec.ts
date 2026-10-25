import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AiAuthError,
  AiConfigError,
  AiContextLengthError,
  type AiMessage,
  AiOverloadedError,
  AiProvider,
  AiRateLimitError,
  AiToolsUnsupportedError,
} from "../../core/index.ts";
import { AlephaAiOpenai, OpenAiCompatibleAiProvider } from "../index.ts";

/**
 * Recorded Chat Completions responses replayed through `send()`, so the
 * provider's own request building, stream reading and error mapping run
 * unchanged.
 */
class RecordedOpenAiProvider extends OpenAiCompatibleAiProvider {
  public sent: Array<{ url: string; init: RequestInit }> = [];
  public replies: Response[] = [];

  protected override async send(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    this.sent.push({ url, init });
    const reply = this.replies.shift();
    if (!reply) {
      throw new Error("no recorded reply left");
    }
    return reply;
  }

  public body(index = this.sent.length - 1): any {
    return JSON.parse(this.sent[index].init.body as string);
  }
}

const chunks = (...list: Array<Record<string, unknown> | "[DONE]">) =>
  new Response(
    list
      .map((c) => `data: ${c === "[DONE]" ? c : JSON.stringify(c)}\n\n`)
      .join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ index: 0, delta: d, finish_reason: finish }],
});

const usage = (prompt: number, completion: number) => ({
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion },
});

const failure = (status: number, message: string, headers = {}) =>
  new Response(JSON.stringify({ error: { message, type: "error" } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("OpenAiCompatibleAiProvider", () => {
  const setup = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({
      env: { AI_API_KEY: "sk-test", AI_MODEL: "gpt-test", ...env },
    })
      // Before the module: the first substitution wins.
      .with({ provide: AiProvider, use: RecordedOpenAiProvider })
      .with(AlephaAiOpenai);
    await alepha.start();
    return {
      ai: alepha.inject(AiProvider),
      recorded: alepha.inject(RecordedOpenAiProvider),
    };
  };

  const tools = [
    {
      name: "listInvoices",
      description: "List invoices",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  it("substitutes AiProvider when its module is registered", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { AI_MODEL: "m" } }).with(
      AlephaAiOpenai,
    );
    await alepha.start();
    expect(alepha.inject(AiProvider)).toBeInstanceOf(
      OpenAiCompatibleAiProvider,
    );
  });

  it("streams text and reads usage from the final chunk", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      chunks(
        delta({ role: "assistant", content: "" }),
        delta({ content: "Hel" }),
        delta({ content: "lo" }),
        delta({}, "stop"),
        usage(11, 2),
        "[DONE]",
      ),
    );

    const events = [];
    for await (const event of ai.chat({
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", inputTokens: 11, outputTokens: 2 },
      { type: "end", reason: "stop" },
    ]);
    const { url, init } = recorded.sent[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test",
    );
    expect(recorded.body()).toMatchObject({
      model: "gpt-test",
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("keeps a token Workers AI streams as a JSON number, and its per-chunk usage", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    // Recorded from Workers AI's OpenAI-compatible endpoint (llama-4-scout):
    // `17` arrives as a number, and every chunk carries a usage, the last
    // one the totals.
    recorded.replies.push(
      chunks(
        {
          ...delta({ content: "", role: "assistant" }),
          usage: { prompt_tokens: 649, completion_tokens: 0 },
        },
        {
          ...delta({ content: "is " }),
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          ...delta({ content: 17 }),
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          ...delta({ content: "°C" }),
          usage: { prompt_tokens: 0, completion_tokens: 1 },
        },
        {
          ...delta({}, "stop"),
          usage: { prompt_tokens: 649, completion_tokens: 11 },
        },
        "[DONE]",
      ),
    );
    const reply = await ai.complete({ messages: [] });
    expect(reply.text).toBe("is 17°C");
    expect(reply.usage).toEqual({ inputTokens: 649, outputTokens: 11 });
  });

  it("assembles parallel tool calls whose arguments arrive in fragments", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      chunks(
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call_a",
              type: "function",
              function: { name: "listInvoices", arguments: "" },
            },
          ],
        }),
        delta({
          tool_calls: [{ index: 0, function: { arguments: '{"query' } }],
        }),
        delta({
          tool_calls: [
            {
              index: 1,
              id: "call_b",
              type: "function",
              function: { name: "getClient", arguments: '{"params":' },
            },
          ],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '":{}}' } }] }),
        delta({
          tool_calls: [{ index: 1, function: { arguments: '{"id":"7"}}' } }],
        }),
        delta({}, "tool_calls"),
        usage(40, 25),
        "[DONE]",
      ),
    );

    const reply = await ai.complete({
      messages: [{ role: "user", content: "x" }],
      tools,
    });

    expect(reply.toolCalls).toEqual([
      { id: "call_a", name: "listInvoices", input: { query: {} } },
      { id: "call_b", name: "getClient", input: { params: { id: "7" } } },
    ]);
    expect(reply.reason).toBe("tool");
    expect(reply.usage).toEqual({ inputTokens: 40, outputTokens: 25 });
    expect(recorded.body().tools).toEqual([
      {
        type: "function",
        function: {
          name: "listInvoices",
          description: "List invoices",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("accepts arguments sent whole as an object, and a call reported with finish stop", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      chunks(
        delta({
          tool_calls: [
            {
              id: "c1",
              function: { name: "listInvoices", arguments: { a: 1 } },
            },
          ],
        }),
        delta({}, "stop"),
        "[DONE]",
      ),
    );
    const reply = await ai.complete({ messages: [], tools });
    expect(reply.toolCalls).toEqual([
      { id: "c1", name: "listInvoices", input: { a: 1 } },
    ]);
    expect(reply.reason).toBe("tool");
  });

  it("round-trips tool results as tool messages", async ({ expect }) => {
    const { recorded } = await setup();
    const messages: AiMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "listInvoices", input: { query: {} } }],
      },
      { role: "tool", callId: "c1", name: "listInvoices", content: "[]" },
      {
        role: "tool",
        callId: "c2",
        name: "x",
        content: "denied by the user",
        isError: true,
      },
    ];
    expect(recorded.toBody({ messages }).messages).toEqual([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "listInvoices", arguments: '{"query":{}}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "[]" },
      {
        role: "tool",
        tool_call_id: "c2",
        content: "Error: denied by the user",
      },
    ]);
  });

  it("maps failures to the typed errors shared with the Anthropic provider", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      failure(401, "Incorrect API key provided"),
      failure(429, "Rate limit reached", { "retry-after": "3" }),
      failure(503, "The server is overloaded"),
      failure(400, "This model's maximum context length is 128000 tokens."),
      failure(
        400,
        "registry.ollama.ai/library/gemma:2b does not support tools",
      ),
    );
    const call = () =>
      ai.complete({ messages: [{ role: "user", content: "x" }] });

    await expect(call()).rejects.toThrow(AiAuthError);
    const limited: any = await call().catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(AiRateLimitError);
    expect(limited.data.retryAfter).toBe(3);
    await expect(call()).rejects.toThrow(AiOverloadedError);
    await expect(call()).rejects.toThrow(AiContextLengthError);
    await expect(call()).rejects.toThrow(AiToolsUnsupportedError);
  });

  it("maps an error chunk inside a started stream", async ({ expect }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      chunks(delta({ content: "a" }), {
        error: { message: "Rate limit", type: "rate_limit_error" },
      }),
    );
    await expect(ai.complete({ messages: [] })).rejects.toThrow(
      AiRateLimitError,
    );
  });

  it("reaches any compatible endpoint through AI_BASE_URL, without a key", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup({
      AI_BASE_URL: "http://localhost:11434/v1/",
      AI_API_KEY: "",
    });
    recorded.replies.push(chunks(delta({ content: "ok" }, "stop"), "[DONE]"));
    await ai.complete({ messages: [] });
    expect(recorded.sent[0].url).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(
      (recorded.sent[0].init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("fails at start without a model", async ({ expect }) => {
    await expect(setup({ AI_MODEL: "" })).rejects.toThrow(AiConfigError);
  });
});
