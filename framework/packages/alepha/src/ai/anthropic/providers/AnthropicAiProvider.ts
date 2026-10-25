import { $hook, $inject } from "alepha";
import {
  type AiChatRequest,
  AiConfigError,
  type AiEndReason,
  type AiEvent,
  AiHttpErrors,
  type AiMessage,
  AiProvider,
  type AiToolDefinition,
  SseReader,
} from "alepha/ai";
import { $logger } from "alepha/logger";

/**
 * AI provider for the Anthropic Messages API, over plain `fetch`.
 *
 * - Streams with server-sent events and maps them to `AiEvent`s: text
 *   deltas as they arrive, a tool call once its input JSON is complete.
 * - Marks the system prompt and the tool list for prompt caching. Both stay
 *   byte-identical across the turns of a conversation (per-turn page data
 *   rides on the user message), so every turn after the first reads them
 *   from the cache.
 * - Keeps the model's thinking blocks on the assistant message (`vendor`)
 *   and sends them back, as the API requires for a turn that called tools.
 * - Maps failures to typed `AiError`s: `AiAuthError` (401, 403),
 *   `AiRateLimitError` (429, with `retryAfter`), `AiOverloadedError` (529),
 *   `AiContextLengthError` (a prompt too long).
 *
 * **Environment:** `AI_API_KEY` and `AI_MODEL` are required, checked at
 * start. `AI_BASE_URL` replaces `https://api.anthropic.com`, for Cloudflare
 * AI Gateway (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`).
 *
 * @example
 * ```ts
 * const app = Alepha.create().with(AlephaAiAnthropic);
 * ```
 */
export class AnthropicAiProvider extends AiProvider {
  public readonly name = "anthropic";

  protected readonly log = $logger();
  protected readonly sse = $inject(SseReader);
  protected readonly errors = $inject(AiHttpErrors);

  /**
   * The `anthropic-version` header the request and event shapes here follow.
   */
  public readonly apiVersion = "2023-06-01";

  /**
   * `max_tokens` when the request sets none. The API requires one.
   */
  public defaultMaxTokens = 16000;

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (!this.env.AI_API_KEY) {
        throw new AiConfigError(
          { provider: this.name },
          {
            message:
              "AlephaAiAnthropic is registered but AI_API_KEY is not set.",
          },
        );
      }
      this.assertModelConfigured();
      this.log.info(
        `Anthropic AI provider ready (model: ${this.env.AI_MODEL ?? "per request"})`,
      );
    },
  });

  /**
   * The endpoint requests go to.
   */
  public get url(): string {
    const base = (this.env.AI_BASE_URL || "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
    return `${base}/v1/messages`;
  }

  /**
   * The JSON body sent for a request. Public so a spec can assert what the
   * API would receive, the cache markers included.
   */
  public toBody(request: AiChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(request),
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream: true,
      messages: this.toMessages(request.messages),
    };

    if (request.system) {
      body.system = [
        {
          type: "text",
          text: request.system,
          cache_control: { type: "ephemeral" },
        },
      ];
    }

    if (request.tools?.length) {
      body.tools = this.toTools(request.tools);
    }

    return body;
  }

  public async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const signal = this.signalOf(request);
    const body = this.toBody(request);

    const response = await this.send(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-api-key": String(this.env.AI_API_KEY ?? ""),
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      throw await this.errors.fromResponse(this.name, response);
    }

    yield* this.readStream(response.body, signal);
  }

  /**
   * Send one HTTP request. The only place this provider touches the network,
   * so a spec replays recorded responses by overriding it.
   */
  protected send(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  /**
   * Map the API's event stream to `AiEvent`s.
   */
  public async *readStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<AiEvent> {
    const blocks = new Map<number, StreamBlock>();
    const thinking: Record<string, unknown>[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let reason: AiEndReason = "stop";

    for await (const sse of this.sse.read(stream, signal)) {
      const data = JSON.parse(sse.data);
      const type = data.type ?? sse.event;

      if (type === "message_start") {
        const usage = data.message?.usage ?? {};
        inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        outputTokens = usage.output_tokens ?? 0;
      } else if (type === "content_block_start") {
        const block = data.content_block ?? {};
        blocks.set(data.index, {
          type: block.type,
          id: block.id,
          name: block.name,
          json: "",
          thinking: block.thinking ?? "",
          signature: block.signature ?? "",
          data: block.data,
        });
        if (block.type === "text" && block.text) {
          yield { type: "text", text: block.text };
        }
      } else if (type === "content_block_delta") {
        const block = blocks.get(data.index);
        const delta = data.delta ?? {};
        if (delta.type === "text_delta") {
          yield { type: "text", text: delta.text };
        } else if (delta.type === "input_json_delta" && block) {
          block.json += delta.partial_json ?? "";
        } else if (delta.type === "thinking_delta" && block) {
          block.thinking += delta.thinking ?? "";
        } else if (delta.type === "signature_delta" && block) {
          block.signature += delta.signature ?? "";
        }
      } else if (type === "content_block_stop") {
        const block = blocks.get(data.index);
        if (block?.type === "tool_use") {
          yield {
            type: "tool_call",
            id: block.id ?? "",
            name: block.name ?? "",
            input: block.json ? JSON.parse(block.json) : {},
          };
        } else if (block?.type === "thinking") {
          thinking.push({
            type: "thinking",
            thinking: block.thinking,
            signature: block.signature,
          });
        } else if (block?.type === "redacted_thinking") {
          thinking.push({ type: "redacted_thinking", data: block.data });
        }
      } else if (type === "message_delta") {
        if (data.usage?.output_tokens !== undefined) {
          outputTokens = data.usage.output_tokens;
        }
        reason = this.toEndReason(data.delta?.stop_reason);
      } else if (type === "error") {
        throw this.errors.fromStreamError(
          this.name,
          data.error?.type,
          data.error?.message ?? "stream error",
        );
      } else if (type === "message_stop") {
        break;
      }
    }

    if (thinking.length) {
      yield { type: "vendor", provider: this.name, data: { thinking } };
    }
    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "end", reason };
  }

  protected toEndReason(stop: string | undefined): AiEndReason {
    if (stop === "tool_use") {
      return "tool";
    }
    if (stop === "max_tokens" || stop === "model_context_window_exceeded") {
      return "length";
    }
    return "stop";
  }

  protected toTools(tools: AiToolDefinition[]): Record<string, unknown>[] {
    return tools.map((tool, index) => {
      const out: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
      // One breakpoint on the last tool caches the whole list, which is
      // rendered before the system prompt.
      if (index === tools.length - 1) {
        out.cache_control = { type: "ephemeral" };
      }
      return out;
    });
  }

  /**
   * Map the conversation to Messages API turns. Consecutive tool results
   * become ONE user message, as the API expects for parallel calls.
   */
  protected toMessages(messages: AiMessage[]): Record<string, unknown>[] {
    const out: { role: string; content: any }[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        out.push({ role: "user", content: message.content });
      } else if (message.role === "assistant") {
        const content: Record<string, unknown>[] = [];
        if (message.vendor?.provider === this.name) {
          const thinking = (message.vendor.data as any)?.thinking;
          if (Array.isArray(thinking)) {
            content.push(...thinking);
          }
        }
        if (message.content) {
          content.push({ type: "text", text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          content.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.input,
          });
        }
        out.push({ role: "assistant", content });
      } else {
        const result = {
          type: "tool_result",
          tool_use_id: message.callId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        };
        const last = out[out.length - 1];
        if (
          last?.role === "user" &&
          Array.isArray(last.content) &&
          last.content.every((b: any) => b.type === "tool_result")
        ) {
          last.content.push(result);
        } else {
          out.push({ role: "user", content: [result] });
        }
      }
    }

    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

interface StreamBlock {
  type: string;
  id?: string;
  name?: string;
  json: string;
  thinking: string;
  signature: string;
  data?: unknown;
}
