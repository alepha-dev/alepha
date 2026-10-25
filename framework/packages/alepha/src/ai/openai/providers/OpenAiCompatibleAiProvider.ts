import { $hook, $inject } from "alepha";
import {
  type AiChatRequest,
  type AiEvent,
  AiHttpErrors,
  AiProvider,
  ChatCompletionFormat,
} from "alepha/ai";
import { $logger } from "alepha/logger";

/**
 * AI provider for the OpenAI Chat Completions wire format, over plain
 * `fetch`, its request and stream mapping in `ChatCompletionFormat`. One provider for every compatible endpoint, picked by
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
  protected readonly errors = $inject(AiHttpErrors);
  protected readonly format = $inject(ChatCompletionFormat);

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
      messages: this.format.toMessages(request),
    };
    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }
    if (request.tools?.length) {
      body.tools = this.format.toTools(request.tools);
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
  public readStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<AiEvent> {
    return this.format.read(this.name, stream, signal);
  }
}
