import { type AiChatRequest, type AiEvent, MemoryAiProvider } from "alepha/ai";

/**
 * A scripted provider that reports usage the way a vendor does, from the
 * request it was sent: the tool definitions, the system prompt and the
 * conversation, at three bytes a token. That is the ratio at which the run
 * of `chat-agent-rounds.spec.ts`, counted at full price, ends where a production run did on
 * 2026-11-26: two lists, then the third call refused (#Q4427).
 *
 * `caching` is Anthropic's accounting, as `AnthropicAiProvider` reports it:
 * the tool list and the system prompt are one cached prefix, written by the
 * first call that sends it and read back by every later one. Without it the
 * provider is Workers AI, which caches nothing.
 */
export class MeteredAiProvider extends MemoryAiProvider {
  public static readonly BYTES_PER_TOKEN = 3;

  public caching = true;

  /**
   * The tokens of each call's cached prefix, oldest first.
   */
  public prefixes: number[] = [];

  protected written = new Set<string>();

  public override async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const prefix =
      JSON.stringify(
        (request.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      ) + (request.system ?? "");
    const warm = this.written.has(prefix);
    this.written.add(prefix);
    const prefixTokens = this.tokens(prefix);
    this.prefixes.push(prefixTokens);
    yield {
      type: "usage",
      inputTokens: prefixTokens + this.tokens(JSON.stringify(request.messages)),
      outputTokens: 40,
      ...(this.caching && warm ? { cachedInputTokens: prefixTokens } : {}),
      ...(this.caching && !warm ? { cacheWriteInputTokens: prefixTokens } : {}),
    };
    yield* super.chat(request);
  }

  protected tokens(text: string): number {
    return Math.ceil(
      Buffer.byteLength(text) / MeteredAiProvider.BYTES_PER_TOKEN,
    );
  }
}
