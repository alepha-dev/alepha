import { $hook, $inject } from "alepha";
import {
  type AiChatRequest,
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
 * AI provider for the OpenAI Chat Completions wire format, over plain
 * `fetch`. One provider for every compatible endpoint, picked by
 * `AI_BASE_URL`:
 *
 * | endpoint | `AI_BASE_URL` |
 * |---|---|
 * | OpenAI (default) | `https://api.openai.com/v1` |
 * | Workers AI over REST | `https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1` |
 * | OpenRouter | `https://openrouter.ai/api/v1` |
 * | Ollama | `http://localhost:11434/v1` |
 * | vLLM, LM Studio, ... | the server's `/v1` |
 *
 * - Streams `delta.content` as text, and assembles `delta.tool_calls`,
 *   whose arguments arrive in fragments keyed by index, into whole calls.
 * - Reads usage from the final chunk (`stream_options.include_usage`).
 * - Maps failures to the typed `AiError`s the Anthropic provider raises, plus
 *   `AiToolsUnsupportedError` for a model without function calling.
 *
 * **Environment:** `AI_MODEL` is required, checked at start. `AI_API_KEY`
 * is sent as a bearer token when set (Ollama needs none).
 *
 * @example
 * ```ts
 * // .env: AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/abc/ai/v1
 * //       AI_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
 * const app = Alepha.create().with(AlephaAiOpenai);
 * ```
 */
export class OpenAiCompatibleAiProvider extends AiProvider {
  public readonly name = "openai";

  protected readonly log = $logger();
  protected readonly sse = $inject(SseReader);
  protected readonly errors = $inject(AiHttpErrors);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.assertModelConfigured();
      this.log.info(
        `OpenAI-compatible AI provider ready (${this.baseUrl}, model: ${this.env.AI_MODEL ?? "per request"})`,
      );
    },
  });

  /**
   * The API root, `/v1` included.
   */
  public get baseUrl(): string {
    return (this.env.AI_BASE_URL || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
  }

  /**
   * The JSON body sent for a request. Public so a spec can assert it.
   */
  public toBody(request: AiChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(request),
      stream: true,
      stream_options: { include_usage: true },
      messages: this.toMessages(request),
    };
    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }
    if (request.tools?.length) {
      body.tools = this.toTools(request.tools);
    }
    return body;
  }

  public async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const signal = this.signalOf(request);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
    };
    if (this.env.AI_API_KEY) {
      headers.authorization = `Bearer ${String(this.env.AI_API_KEY)}`;
    }

    const response = await this.send(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(this.toBody(request)),
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
   * Map the chunk stream to `AiEvent`s.
   */
  public async *readStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<AiEvent> {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    for await (const event of this.sse.read(stream, signal)) {
      if (event.data === "[DONE]") {
        break;
      }
      const chunk = JSON.parse(event.data);
      if (chunk.error) {
        throw this.errors.fromStreamError(
          this.name,
          chunk.error.type ?? chunk.error.code,
          chunk.error.message ?? String(chunk.error),
        );
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {};
        // Workers AI streams a token that parses as a number as a JSON
        // number (`"content": 17`): found by the live spec, dropped silently
        // by a string-only check.
        if (
          delta.content !== undefined &&
          delta.content !== null &&
          delta.content !== ""
        ) {
          yield { type: "text", text: String(delta.content) };
        }
        for (const part of delta.tool_calls ?? []) {
          const index = part.index ?? calls.size;
          const call = calls.get(index) ?? { id: "", name: "", args: "" };
          if (part.id) {
            call.id = part.id;
          }
          if (part.function?.name) {
            call.name += part.function.name;
          }
          const args = part.function?.arguments;
          if (args !== undefined && args !== null) {
            // Some servers (Workers AI) send the arguments as an object in
            // one piece rather than as string fragments.
            call.args += typeof args === "string" ? args : JSON.stringify(args);
          }
          calls.set(index, call);
        }
        if (choice.finish_reason) {
          finish = choice.finish_reason;
        }
      }
    }

    for (const [index, call] of [...calls.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      yield {
        type: "tool_call",
        id: call.id || `call_${index}`,
        name: call.name,
        input: call.args ? JSON.parse(call.args) : {},
      };
    }
    if (usage) {
      yield { type: "usage", ...usage };
    }
    yield { type: "end", reason: this.toEndReason(finish, calls.size > 0) };
  }

  protected toEndReason(
    finish: string | undefined,
    called: boolean,
  ): AiEndReason {
    if (finish === "length") {
      return "length";
    }
    // Ollama reports "stop" for a response that called tools.
    if (finish === "tool_calls" || finish === "function_call" || called) {
      return "tool";
    }
    return "stop";
  }

  protected toTools(tools: AiToolDefinition[]): Record<string, unknown>[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  protected toMessages(request: AiChatRequest): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    if (request.system) {
      out.push({ role: "system", content: request.system });
    }
    for (const message of request.messages as AiMessage[]) {
      if (message.role === "user") {
        out.push({ role: "user", content: message.content });
      } else if (message.role === "assistant") {
        const turn: Record<string, unknown> = {
          role: "assistant",
          content: message.content || null,
        };
        if (message.toolCalls?.length) {
          turn.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.input),
            },
          }));
        }
        out.push(turn);
      } else {
        out.push({
          role: "tool",
          tool_call_id: message.callId,
          content: message.isError
            ? `Error: ${message.content}`
            : message.content,
        });
      }
    }
    return out;
  }
}
