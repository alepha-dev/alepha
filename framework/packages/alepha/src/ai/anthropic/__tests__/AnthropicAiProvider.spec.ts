import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AiAuthError,
  AiConfigError,
  AiContextLengthError,
  AiOverloadedError,
  AiProvider,
  type AiMessage,
  AiRateLimitError,
} from "../../core/index.ts";
import { AlephaAiAnthropic, AnthropicAiProvider } from "../index.ts";

/**
 * Recorded Messages API responses replayed through a subclass that answers
 * `send()` from a queue, so the provider's own fetch path, headers and error
 * mapping run unchanged.
 */
class RecordedAnthropicAiProvider extends AnthropicAiProvider {
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

const sse = (...events: Array<Record<string, unknown>>) =>
  new Response(
    events
      .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const textReply = (text: string) =>
  sse(
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    { type: "ping" },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: text.slice(0, 3) },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: text.slice(3) },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 7 },
    },
    { type: "message_stop" },
  );

const toolReply = () =>
  sse(
    { type: "message_start", message: { usage: { input_tokens: 50 } } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "sig-abc" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_1",
        name: "listInvoices",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"query":{"sta' },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 'tus":"open"}}' },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 30 },
    },
    { type: "message_stop" },
  );

const errorReply = (
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("AnthropicAiProvider", () => {
  const setup = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({
      env: { AI_API_KEY: "sk-test", AI_MODEL: "claude-test", ...env },
    })
      // Before the module: the first substitution wins, so the recorded
      // subclass answers as the AiProvider.
      .with({ provide: AiProvider, use: RecordedAnthropicAiProvider })
      .with(AlephaAiAnthropic);
    await alepha.start();
    return {
      alepha,
      ai: alepha.inject(AiProvider),
      recorded: alepha.inject(RecordedAnthropicAiProvider),
    };
  };

  const tools = [
    {
      name: "listInvoices",
      description: "List the invoices of the signed-in user",
      inputSchema: {
        type: "object",
        properties: { query: { type: "object" } },
      },
    },
  ];

  it("substitutes AiProvider when its module is registered, on Node too", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { AI_API_KEY: "sk-test", AI_MODEL: "claude-test" },
    }).with(AlephaAiAnthropic);
    await alepha.start();
    expect(alepha.inject(AiProvider)).toBeInstanceOf(AnthropicAiProvider);
  });

  it("streams text and usage, counting cached input tokens", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(textReply("Hello there"));

    const events = [];
    for await (const event of ai.chat({
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo there" },
      { type: "usage", inputTokens: 120, outputTokens: 7 },
      { type: "end", reason: "stop" },
    ]);
    const { url, init } = recorded.sent[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-test",
    );
    expect(recorded.body().model).toBe("claude-test");
    expect(recorded.body().stream).toBe(true);
  });

  it("assembles a tool call from fragmented input JSON and keeps thinking", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(toolReply());

    const events = [];
    for await (const event of ai.chat({
      messages: [{ role: "user", content: "open invoices?" }],
      tools,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        id: "toolu_1",
        name: "listInvoices",
        input: { query: { status: "open" } },
      },
      {
        type: "vendor",
        provider: "anthropic",
        data: {
          thinking: [{ type: "thinking", thinking: "", signature: "sig-abc" }],
        },
      },
      { type: "usage", inputTokens: 50, outputTokens: 30 },
      { type: "end", reason: "tool" },
    ]);
  });

  it("round-trips tool results in a second turn, thinking first", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(toolReply(), textReply("Two invoices."));

    const messages: AiMessage[] = [{ role: "user", content: "open invoices?" }];
    const first = await ai.complete({ messages, tools });
    messages.push(
      {
        role: "assistant",
        content: first.text,
        toolCalls: first.toolCalls,
        vendor: first.vendor,
      },
      {
        role: "tool",
        callId: "toolu_1",
        name: "listInvoices",
        content: '[{"id":1},{"id":2}]',
      },
    );
    const second = await ai.complete({ messages, tools });

    expect(second.text).toBe("Two invoices.");
    expect(recorded.body(1).messages).toEqual([
      { role: "user", content: "open invoices?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "sig-abc" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "listInvoices",
            input: { query: { status: "open" } },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: '[{"id":1},{"id":2}]',
          },
        ],
      },
    ]);
  });

  it("puts parallel tool results in one user message, errors flagged", async ({
    expect,
  }) => {
    const { recorded } = await setup();
    const body = recorded.toBody({
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "a", name: "x", input: {} },
            { id: "b", name: "y", input: {} },
          ],
        },
        { role: "tool", callId: "a", name: "x", content: "ok" },
        {
          role: "tool",
          callId: "b",
          name: "y",
          content: "denied by the user",
          isError: true,
        },
      ],
    }) as any;
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "ok" },
        {
          type: "tool_result",
          tool_use_id: "b",
          content: "denied by the user",
          is_error: true,
        },
      ],
    });
  });

  it("marks the system prompt and the tool list for caching, byte-identical across turns", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(textReply("one"), textReply("two"));
    const system = "You are the billing assistant.";

    await ai.complete({
      system,
      tools,
      messages: [{ role: "user", content: "first\n<page>/invoices</page>" }],
    });
    await ai.complete({
      system,
      tools,
      messages: [
        { role: "user", content: "first\n<page>/invoices</page>" },
        { role: "assistant", content: "one" },
        { role: "user", content: "second\n<page>/invoices/7</page>" },
      ],
    });

    const [a, b] = [recorded.body(0), recorded.body(1)];
    expect(a.system).toEqual([
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ]);
    expect(a.tools[a.tools.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
    expect(JSON.stringify(b.tools)).toBe(JSON.stringify(a.tools));
  });

  it("maps 401, 429, 529 and a prompt too long to typed errors", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      errorReply(401, "authentication_error", "invalid x-api-key"),
      errorReply(429, "rate_limit_error", "slow down", { "retry-after": "12" }),
      errorReply(529, "overloaded_error", "Overloaded"),
      errorReply(
        400,
        "invalid_request_error",
        "prompt is too long: 1200000 tokens > 1000000 maximum",
      ),
    );
    const call = () =>
      ai.complete({ messages: [{ role: "user", content: "x" }] });

    await expect(call()).rejects.toThrow(AiAuthError);
    const limited: any = await call().catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(AiRateLimitError);
    expect(limited.data).toEqual({
      provider: "anthropic",
      status: 429,
      retryAfter: 12,
    });
    await expect(call()).rejects.toThrow(AiOverloadedError);
    await expect(call()).rejects.toThrow(AiContextLengthError);
  });

  it("maps an error event inside a started stream", async ({ expect }) => {
    const { ai, recorded } = await setup();
    recorded.replies.push(
      sse(
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        },
      ),
    );
    await expect(ai.complete({ messages: [] })).rejects.toThrow(
      AiOverloadedError,
    );
  });

  it("goes through AI_BASE_URL, for Cloudflare AI Gateway", async ({
    expect,
  }) => {
    const { ai, recorded } = await setup({
      AI_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/",
    });
    recorded.replies.push(textReply("hi"));
    await ai.complete({ messages: [{ role: "user", content: "x" }] });
    expect(recorded.sent[0].url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages",
    );
  });

  it("fails at start without AI_API_KEY or without a model", async ({
    expect,
  }) => {
    await expect(setup({ AI_API_KEY: "" })).rejects.toThrow(AiConfigError);
    await expect(setup({ AI_MODEL: "" })).rejects.toThrow("set AI_MODEL");
  });
});
