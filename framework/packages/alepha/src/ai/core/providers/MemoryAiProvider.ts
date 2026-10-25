import type { AiChatRequest, AiEvent } from "./AiProvider.ts";
import { AiProvider } from "./AiProvider.ts";

/**
 * The in-memory AI provider: the default everywhere, and the one specs drive.
 *
 * Each {@link script} call queues one response, played back by the next
 * {@link chat} call in order. With nothing queued it answers one text reply
 * saying no vendor module is registered, so a dev page with a chat renders
 * and names its own cause instead of failing.
 *
 * Every request is kept in {@link requests}, so a spec can assert what the
 * model would have been sent.
 *
 * @example
 * ```ts
 * const ai = alepha.inject(MemoryAiProvider);
 * ai.script([
 *   { type: "tool_call", id: "c1", name: "listInvoices", input: {} },
 * ]);
 * ai.script([{ type: "text", text: "You have two invoices." }]);
 * ```
 */
export class MemoryAiProvider extends AiProvider {
  public readonly name = "memory";

  /**
   * Every request this provider received, oldest first.
   */
  public requests: AiChatRequest[] = [];

  protected scripted: AiEvent[][] = [];

  /**
   * Queue one response. A response without an `end` event gets one: `tool`
   * when it holds a tool call, else `stop`.
   */
  public script(events: AiEvent[]): this {
    this.scripted.push(events);
    return this;
  }

  /**
   * The responses queued and not yet played.
   */
  public get pending(): number {
    return this.scripted.length;
  }

  /**
   * The last request received.
   */
  public get last(): AiChatRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  /**
   * Forget the queued responses and the recorded requests.
   */
  public reset(): void {
    this.requests = [];
    this.scripted = [];
  }

  public async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const signal = this.signalOf(request);
    this.requests.push(request);

    const events = this.scripted.shift() ?? this.unscripted();
    let ended = false;

    for (const event of events) {
      signal.throwIfAborted();
      // A real stream arrives over time: yielding to the event loop lets a
      // consumer abort between two events, as it could on the wire.
      await Promise.resolve();
      signal.throwIfAborted();
      if (event.type === "end") {
        ended = true;
      }
      yield event;
      if (ended) {
        return;
      }
    }

    signal.throwIfAborted();
    yield {
      type: "end",
      reason: events.some((e) => e.type === "tool_call") ? "tool" : "stop",
    };
  }

  protected unscripted(): AiEvent[] {
    return [
      {
        type: "text",
        text: "No AI vendor module is registered, so this reply comes from MemoryAiProvider. Register AlephaAiCloudflare (alepha/ai/cloudflare), AlephaAiOpenai (alepha/ai/openai) or AlephaAiAnthropic (alepha/ai/anthropic) to talk to a model.",
      },
      { type: "end", reason: "stop" },
    ];
  }
}
