import { $inject } from "alepha";

import type {
  AiChatRequest,
  AiEndReason,
  AiEvent,
  AiToolDefinition,
} from "../providers/AiProvider.ts";
import { AiHttpErrors } from "./AiHttpErrors.ts";
import { SseReader } from "./SseReader.ts";

/**
 * The OpenAI Chat Completions wire format, both ways: a request's messages
 * and tools out, a streamed response's chunks in.
 *
 * Shared by `OpenAiCompatibleAiProvider` (any HTTP endpoint speaking it) and
 * `WorkersAiProvider` (the `env.AI` binding, whose current models stream the
 * same chunks), so both read a stream the same way.
 *
 * Reading is deliberately tolerant, because the servers differ:
 *
 * - tool-call arguments arrive as string fragments keyed by `index`, or
 *   whole, as an object (Workers AI);
 * - a token that parses as a number may arrive as a JSON number
 *   (`"content": 17`, Workers AI);
 * - a response that called tools may finish with `stop` (Ollama);
 * - usage comes on the last chunk (`stream_options.include_usage`), or on
 *   every chunk with the totals last (Workers AI): the last one wins;
 * - Workers AI's older models stream `{ response, tool_calls }` instead of
 *   `choices`, which is read too.
 */
export class ChatCompletionFormat {
  protected readonly sse = $inject(SseReader);
  protected readonly errors = $inject(AiHttpErrors);

  /**
   * The `messages` array, the system prompt first.
   */
  public toMessages(request: AiChatRequest): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    if (request.system) {
      out.push({ role: "system", content: request.system });
    }
    for (const message of request.messages) {
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

  /**
   * The `tools` array.
   */
  public toTools(tools: AiToolDefinition[]): Record<string, unknown>[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Map a streamed response to `AiEvent`s. `provider` names the vendor in
   * the errors an in-stream failure raises.
   */
  public async *read(
    provider: string,
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<AiEvent> {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    const addCall = (
      index: number,
      part: { id?: string | null; name?: string; arguments?: unknown },
    ) => {
      const call = calls.get(index) ?? { id: "", name: "", args: "" };
      if (part.id) {
        call.id = part.id;
      }
      if (part.name) {
        call.name += part.name;
      }
      if (part.arguments !== undefined && part.arguments !== null) {
        call.args +=
          typeof part.arguments === "string"
            ? part.arguments
            : JSON.stringify(part.arguments);
      }
      calls.set(index, call);
    };

    for await (const event of this.sse.read(stream, signal)) {
      if (event.data === "[DONE]") {
        break;
      }
      const chunk = JSON.parse(event.data);
      if (chunk.error || chunk.errors?.length) {
        const error = chunk.error ?? chunk.errors[0];
        throw this.errors.fromStreamError(
          provider,
          error.type ?? error.code,
          error.message ?? String(error),
        );
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      if (Array.isArray(chunk.choices)) {
        for (const choice of chunk.choices) {
          const delta = choice.delta ?? {};
          if (this.hasText(delta.content)) {
            yield { type: "text", text: String(delta.content) };
          }
          for (const part of delta.tool_calls ?? []) {
            addCall(part.index ?? calls.size, {
              id: part.id,
              name: part.function?.name,
              arguments: part.function?.arguments,
            });
          }
          if (choice.finish_reason) {
            finish = choice.finish_reason;
          }
        }
      } else {
        // Workers AI's older output: `response` text and whole tool calls.
        if (this.hasText(chunk.response)) {
          yield { type: "text", text: String(chunk.response) };
        }
        for (const part of chunk.tool_calls ?? []) {
          addCall(calls.size, part);
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

  protected hasText(content: unknown): boolean {
    return content !== undefined && content !== null && content !== "";
  }

  protected toEndReason(
    finish: string | undefined,
    called: boolean,
  ): AiEndReason {
    if (finish === "length") {
      return "length";
    }
    if (finish === "tool_calls" || finish === "function_call" || called) {
      return "tool";
    }
    return "stop";
  }
}
