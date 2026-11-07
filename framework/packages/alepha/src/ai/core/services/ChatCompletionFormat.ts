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
 *   `choices`, which is read too;
 * - a model may write its tool call as content text instead
 *   (`[{"name": "...", "arguments": {...}}]`, optionally after
 *   `[TOOL_CALLS]`), when the server's tool parser misses its output
 *   (Mistral on Workers AI): with the offered tool names, such a reply is
 *   held back and read as calls.
 */
/**
 * The marker Mistral-family models put before the calls they write.
 */
const TOOL_CALLS_MARKER = "[TOOL_CALLS]";

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
   * the errors an in-stream failure raises. `tools` names the tools the
   * request offered: with them, a call the model wrote as text is read as a
   * call (see the class notes). Reply text that cannot be one streams as it
   * comes; text that could be is held until the end of the response.
   */
  public async *read(
    provider: string,
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    tools?: readonly string[],
  ): AsyncIterable<AiEvent> {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    // The reply so far, while it may still be a call written as text.
    let held = "";
    let holding = Boolean(tools?.length);

    const text = (part: unknown): AiEvent | undefined => {
      if (!holding) {
        return { type: "text", text: String(part) };
      }
      held += String(part);
      if (this.mayBeTextualCall(held)) {
        return undefined;
      }
      holding = false;
      const out = held;
      held = "";
      return { type: "text", text: out };
    };

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
            const event = text(delta.content);
            if (event) {
              yield event;
            }
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
          const event = text(chunk.response);
          if (event) {
            yield event;
          }
        }
        for (const part of chunk.tool_calls ?? []) {
          addCall(calls.size, part);
        }
      }
    }

    if (held) {
      const written = this.parseTextualCalls(held, tools ?? []);
      if (written) {
        for (const call of written) {
          calls.set(calls.size, {
            id: "",
            name: call.name,
            args: JSON.stringify(call.input),
          });
        }
      } else {
        yield { type: "text", text: held };
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

  /**
   * Whether a reply that starts with `text` may still turn out to be a tool
   * call written as text: `{`, `[{` or `[TOOL_CALLS]`, whitespace aside, or
   * a beginning of one of them. A markdown link (`[x](...)`) is not.
   */
  public mayBeTextualCall(text: string): boolean {
    let rest = text.trimStart();
    if (TOOL_CALLS_MARKER.startsWith(rest)) {
      return true;
    }
    if (rest.startsWith(TOOL_CALLS_MARKER)) {
      rest = rest.slice(TOOL_CALLS_MARKER.length).trimStart();
    }
    if (rest === "" || rest.startsWith("{")) {
      return true;
    }
    if (rest.startsWith("[")) {
      const next = rest.slice(1).trimStart();
      return next === "" || next.startsWith("{");
    }
    return false;
  }

  /**
   * The calls a whole reply wrote as text, or `undefined` when it is not
   * exactly that: one call or an array of calls, each
   * `{ name, arguments | parameters }` with `name` among `tools` and an
   * object (or a JSON string of one) as its input.
   */
  public parseTextualCalls(
    text: string,
    tools: readonly string[],
  ): Array<{ name: string; input: Record<string, unknown> }> | undefined {
    let body = text.trim();
    if (body.startsWith(TOOL_CALLS_MARKER)) {
      body = body.slice(TOOL_CALLS_MARKER.length).trim();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length === 0) {
      return undefined;
    }
    const out: Array<{ name: string; input: Record<string, unknown> }> = [];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const { name } = item as { name?: unknown };
      if (typeof name !== "string" || !tools.includes(name)) {
        return undefined;
      }
      let input =
        (item as { arguments?: unknown; parameters?: unknown }).arguments ??
        (item as { parameters?: unknown }).parameters ??
        {};
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          return undefined;
        }
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return undefined;
      }
      out.push({ name, input: input as Record<string, unknown> });
    }
    return out;
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
