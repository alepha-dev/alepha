import { $env, $inject, Alepha, z } from "alepha";

import { AiConfigError } from "../errors/AiConfigError.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  AI_MODEL: z
    .text({
      secret: false,
      description:
        "Model id the vendor provider sends when a request names none, for example `claude-sonnet-5-5` or `@cf/meta/llama-4-scout-17b-16e-instruct`. The framework ships no fallback model id, so a vendor provider without one fails at start.",
    })
    .optional(),
  AI_API_KEY: z
    .text({
      description:
        "API key of the vendor (Anthropic, OpenAI, OpenRouter, the Workers AI REST API). Unused by the in-memory provider and by the Workers AI binding.",
    })
    .optional(),
  AI_BASE_URL: z
    .text({
      secret: false,
      description:
        "Base URL in place of the default endpoint of the vendor, to go through Cloudflare AI Gateway, a local Ollama or any compatible endpoint.",
    })
    .optional(),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The contract every AI vendor implements: one streamed chat call.
 *
 * Which vendor answers is decided by the module the app registers, never by
 * an env string: `AlephaAi` installs {@link MemoryAiProvider} as the default,
 * and a vendor module (`alepha/ai/anthropic`, `alepha/ai/openai`,
 * `alepha/ai/cloudflare`) substitutes itself for this class.
 *
 * A provider is stateless between calls: the whole conversation travels in
 * every {@link AiChatRequest}.
 *
 * @example
 * ```ts
 * class Summary {
 *   ai = $inject(AiProvider);
 *
 *   async summarize(text: string) {
 *     const reply = await this.ai.complete({
 *       system: "Summarize in one sentence.",
 *       messages: [{ role: "user", content: text }],
 *     });
 *     return reply.text;
 *   }
 * }
 * ```
 */
export abstract class AiProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);

  /**
   * Short name of the vendor, used in logs and in the `provider` field of
   * the errors this provider raises.
   */
  public abstract readonly name: string;

  /**
   * Stream one model response.
   *
   * The stream yields `text` deltas and `tool_call` events as the model
   * produces them, at most one `usage` event, and always ends with one `end`
   * event. Aborting the request's signal (or, without one, the ambient
   * `alepha.context.signal`) cancels the call and makes the iterator throw
   * the abort reason.
   */
  public abstract chat(request: AiChatRequest): AsyncIterable<AiEvent>;

  /**
   * Run {@link chat} to its end and collect the result.
   */
  public async complete(request: AiChatRequest): Promise<AiCompletion> {
    const completion: AiCompletion = {
      text: "",
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: "stop",
    };

    for await (const event of this.chat(request)) {
      if (event.type === "text") {
        completion.text += event.text;
      } else if (event.type === "tool_call") {
        completion.toolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input,
        });
      } else if (event.type === "usage") {
        completion.usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        };
      } else if (event.type === "vendor") {
        completion.vendor = { provider: event.provider, data: event.data };
      } else if (event.type === "end") {
        completion.reason = event.reason;
      }
    }

    return completion;
  }

  /**
   * The model a request runs on: its own `model`, else `AI_MODEL`.
   *
   * @throws AiConfigError when neither is set. There is deliberately no
   * default model id in the framework: ids go stale.
   */
  public resolveModel(request: Pick<AiChatRequest, "model">): string {
    const model = request.model || this.env.AI_MODEL;
    if (!model) {
      throw new AiConfigError(
        { provider: this.name },
        {
          message: `No model for the '${this.name}' AI provider: set AI_MODEL, or a model on the request.`,
        },
      );
    }
    return model;
  }

  /**
   * Fail at start when no model can ever be resolved: no `AI_MODEL`, and
   * not every `$ai` names its own `model`. Vendor providers call it from
   * their `start` hook.
   *
   * @throws AiConfigError naming this provider.
   */
  public assertModelConfigured(): void {
    if (this.env.AI_MODEL) {
      return;
    }
    const declared = this.alepha.primitives("$ai") as Array<{
      options?: { model?: string };
    }>;
    if (declared.length > 0 && declared.every((ai) => ai.options?.model)) {
      return;
    }
    throw new AiConfigError(
      { provider: this.name },
      {
        message: `No model for the '${this.name}' AI provider: set AI_MODEL, or a model on every $ai.`,
      },
    );
  }

  /**
   * The signal a call honours: the request's own, else the ambient one of
   * the current unit of work (a request's, a job's, the app's).
   */
  protected signalOf(request: AiChatRequest): AbortSignal {
    return request.signal ?? this.alepha.context.signal;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One call to a model: the conversation so far, the tools it may call.
 */
export interface AiChatRequest {
  /**
   * Model id. Falls back to `AI_MODEL`.
   */
  model?: string;

  /**
   * The system prompt. Kept stable across the turns of a conversation, so
   * a vendor can cache it: per-turn data (the page the user is on) belongs
   * on the user message instead.
   */
  system?: string;

  messages: AiMessage[];

  /**
   * Tools the model may call, described by JSON Schema.
   */
  tools?: AiToolDefinition[];

  /**
   * Upper bound on the tokens the model may generate for this response.
   */
  maxTokens?: number;

  /**
   * Cancels the call. Defaults to `alepha.context.signal`.
   */
  signal?: AbortSignal;
}

/**
 * One message of a conversation.
 *
 * - `user`: what the person typed.
 * - `assistant`: what the model answered, with the tools it called.
 * - `tool`: the result of one tool call, matched to it by `callId`.
 */
export type AiMessage = AiUserMessage | AiAssistantMessage | AiToolMessage;

export interface AiUserMessage {
  role: "user";
  content: string;
}

export interface AiAssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: AiToolCall[];
  /**
   * What the vendor asked to get back with this message, opaque to
   * everything but the provider that wrote it (Anthropic's signed thinking
   * blocks, which a turn that called tools must replay). A provider ignores
   * another vendor's data.
   */
  vendor?: AiVendorData;
}

/**
 * Opaque per-vendor data carried on an assistant message.
 */
export interface AiVendorData {
  provider: string;
  data: unknown;
}

export interface AiToolMessage {
  role: "tool";
  callId: string;
  name: string;
  /**
   * The result, serialized as text (JSON for structured results).
   */
  content: string;
  /**
   * The call failed: `content` is the error the model should read.
   */
  isError?: boolean;
}

/**
 * A tool call the model asked for.
 */
export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * A tool as a vendor sees it: a name, a description and a JSON Schema of
 * its input object. Build `inputSchema` with `AiToolSchema.toJsonSchema`.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Why a response ended.
 *
 * - `stop`: the model finished its answer.
 * - `tool`: the model is waiting for the results of its tool calls.
 * - `length`: a token or step limit cut it.
 */
export type AiEndReason = "stop" | "tool" | "length";

/**
 * One event of a streamed response.
 *
 * `vendor` carries data the provider needs back on the next request (see
 * {@link AiAssistantMessage.vendor}); a caller stores it and otherwise
 * ignores it.
 */
export type AiEvent =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "vendor"; provider: string; data: unknown }
  | { type: "end"; reason: AiEndReason };

/**
 * A whole response, as {@link AiProvider.complete} collects it.
 */
export interface AiCompletion {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  reason: AiEndReason;
  /**
   * Vendor data to store on the assistant message, see
   * {@link AiAssistantMessage.vendor}.
   */
  vendor?: AiVendorData;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}
