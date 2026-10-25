import { $inject, createPrimitive, Primitive, type ZType } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { KIND } from "alepha/internal";
import type { UserAccountToken } from "alepha/security";
import type { ActionPrimitive } from "alepha/server";

import { AiConfigError } from "../errors/AiConfigError.ts";
import {
  type AiAssistantMessage,
  type AiEndReason,
  type AiMessage,
  AiProvider,
  type AiToolCall,
  type AiToolDefinition,
  type AiToolMessage,
  type AiUsage,
  type AiUserMessage,
  type AiVendorData,
} from "../providers/AiProvider.ts";
import {
  AiContextBlock,
  type AiPageContext,
} from "../services/AiContextBlock.ts";
import { AiToolSchema } from "../services/AiToolSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Declares an assistant: a system prompt, the `$action`s it may call, and a
 * tool loop that runs them as the signed-in user.
 *
 * - **Tools are `$action`s.** Each becomes a tool named after the action,
 *   described by its `description`, taking `{ params, query, body }` for the
 *   parts the action declares. It runs through `action.run(input, { user })`,
 *   so the action's own `use: [$secure(...)]` decides, and the assistant can
 *   never do more than the user could. A refusal, a validation error or a
 *   thrown error goes back to the model as a tool error.
 * - **Mutations wait for the user.** A call to a non-GET action (or whatever
 *   `confirm` says) pauses the turn with a `confirm` event; a client tool
 *   (see {@link clientTool}) pauses with a `client_tool` event.
 * - **Re-entrant.** The loop's whole state is the message list. A pause ends
 *   the stream; resuming is a new `stream()` with the stored messages and
 *   `resume: { callId, decision }` or `{ callId, result }`. An approved call
 *   runs the input stored in the messages, never input sent back by a
 *   browser. Nothing lives in memory between requests, which is the shape
 *   that works on Workers.
 * - **Page context** rides on the latest user message, capped at 8 KB, never
 *   in the system prompt, which stays cacheable.
 *
 * @example
 * ```ts
 * class Support {
 *   invoices = $inject(InvoiceApi);
 *
 *   assistant = $ai({
 *     system: "You help with invoices. Be brief.",
 *     tools: [this.invoices.list, this.invoices.create],
 *   });
 *
 *   async answer(messages: AiMessage[], user: UserAccountToken) {
 *     for await (const event of this.assistant.stream({ messages, user })) {
 *       // persist `message` events, forward `text`, stop on a pause
 *     }
 *   }
 * }
 * ```
 */
export const $ai = (options: AiPrimitiveOptions): AiPrimitive =>
  createPrimitive(AiPrimitive, options);

/**
 * A tool the browser runs (`navigate`, `fillForm`): calling it pauses the
 * turn with a `client_tool` event, and the result comes back on resume.
 */
export const clientTool = (
  name: string,
  options: { description: string; schema: ZType },
): AiClientTool => ({ kind: "client", name, ...options });

// ---------------------------------------------------------------------------------------------------------------------

export interface AiPrimitiveOptions {
  /**
   * Name of the assistant, in logs. Defaults to the property key.
   */
  name?: string;

  /**
   * Model id for this assistant. Falls back to `AI_MODEL`.
   */
  model?: string;

  /**
   * The system prompt, or a function of the user. Keep it stable across the
   * turns of a conversation: it is what the vendor caches.
   */
  system: string | ((ctx: { user?: UserAccountToken }) => string);

  /**
   * The tools: `$action`s, and client tools from {@link clientTool}.
   */
  tools?: Array<ActionPrimitive<any> | AiClientTool>;

  /**
   * Whether a call to this action waits for the user's approval. Default:
   * every action whose method is not GET.
   */
  confirm?: (tool: { name: string; method: string }) => boolean;

  /**
   * Model calls per turn before the loop stops with `end: length`.
   *
   * @default 10
   */
  maxSteps?: number;

  /**
   * Wall-clock bound on one `stream()`, aborting the model call in flight.
   */
  timeout?: DurationLike;

  /**
   * Upper bound on the tokens of each model response.
   */
  maxTokens?: number;
}

/**
 * A client tool, from {@link clientTool}.
 */
export interface AiClientTool {
  kind: "client";
  name: string;
  description: string;
  schema: ZType;
}

/**
 * One step of a turn: what `stream()` takes.
 */
export interface AiTurnInput {
  /**
   * The conversation as stored. For a new turn, the user's new message is
   * last; for a resume, the stored messages as they were at the pause.
   */
  messages: AiMessage[];

  /**
   * The page the user is on, appended to their new message.
   */
  context?: AiPageContext;

  /**
   * The resolved user every tool runs as. Without one, a `$secure` action
   * refuses, which is the safe default; there is no "system" fallback.
   */
  user?: UserAccountToken;

  /**
   * Continue a paused turn: the user's decision on a confirmation, or a
   * client tool's result.
   */
  resume?: AiResume;

  /**
   * Cancels the turn. Combined with the ambient signal and `timeout`.
   */
  signal?: AbortSignal;
}

export type AiResume =
  | { callId: string; decision: "approve" | "deny" }
  | { callId: string; result: unknown };

/**
 * The call a paused turn waits on. Persist it: resuming checks the
 * `callId` against it.
 */
export interface AiPendingCall {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  kind: "confirm" | "client_tool";
}

/**
 * One event of a turn.
 *
 * - `text`: a delta of the assistant's reply, to forward.
 * - `message`: a message complete, to persist in order (the user's message
 *   with its context, each assistant message with its usage, each tool
 *   result).
 * - `tool_call`: an automatic call starting, for a progress line.
 * - `confirm` / `client_tool`: the turn paused on this call; persist it.
 * - `end`: the turn is over (`stop`, `length`) or paused (`paused`).
 */
export type AiTurnEvent =
  | { type: "text"; text: string }
  | {
      type: "message";
      message: AiMessage;
      usage?: AiUsage;
      model?: string;
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | ({ type: "confirm" } & Omit<AiPendingCall, "kind">)
  | ({ type: "client_tool" } & Omit<AiPendingCall, "kind">)
  | { type: "end"; reason: AiEndReason | "paused" };

/**
 * What `run()` collects.
 */
export interface AiTurnResult {
  /**
   * The messages this step produced, in order: persist them after the
   * stored ones.
   */
  messages: AiMessage[];
  /**
   * The final assistant text of this step.
   */
  text: string;
  usage: AiUsage;
  reason: AiEndReason | "paused";
  pending?: AiPendingCall;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AiPrimitive extends Primitive<AiPrimitiveOptions> {
  protected readonly provider = $inject(AiProvider);
  protected readonly toolSchema = $inject(AiToolSchema);
  protected readonly contextBlock = $inject(AiContextBlock);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The tools by name, with their vendor definitions. Built and checked at
   * init, so a bad name or a missing description fails at start.
   */
  protected tools = new Map<string, AiTool>();

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * The tool definitions sent to the vendor, in declaration order (stable,
   * so the vendor caches them).
   */
  public get definitions(): AiToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  protected onInit(): void {
    for (const tool of this.options.tools ?? []) {
      const entry = this.toTool(tool);
      if (this.tools.has(entry.definition.name)) {
        throw new AiConfigError(
          {},
          {
            message: `$ai '${this.name}': two tools are named '${entry.definition.name}'.`,
          },
        );
      }
      this.tools.set(entry.definition.name, entry);
    }
  }

  /**
   * Run one step of a turn: until the model stops, a call needs the user, or
   * a bound is hit.
   */
  public async *stream(input: AiTurnInput): AsyncIterable<AiTurnEvent> {
    const signal = this.signalOf(input);
    const messages = [...input.messages];
    const system =
      typeof this.options.system === "function"
        ? this.options.system({ user: input.user })
        : this.options.system;

    if (input.resume) {
      const outcome = yield* this.resumeCalls(messages, input);
      if (outcome === "paused") {
        yield { type: "end", reason: "paused" };
        return;
      }
    } else if (input.context) {
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        const withContext: AiUserMessage = {
          role: "user",
          content: this.contextBlock.append(last.content, input.context),
        };
        messages[messages.length - 1] = withContext;
        yield { type: "message", message: withContext };
      }
    }

    const maxSteps = this.options.maxSteps ?? 10;
    for (let step = 0; step < maxSteps; step++) {
      signal.throwIfAborted();
      const assistant: AiAssistantMessage = { role: "assistant", content: "" };
      const calls: AiToolCall[] = [];
      let usage: AiUsage | undefined;
      let vendor: AiVendorData | undefined;
      let reason: AiEndReason = "stop";

      for await (const event of this.provider.chat({
        model: this.options.model,
        system,
        // A copy: the loop appends to its own list, and a provider (or a
        // spec recording requests) must see the conversation as it was sent.
        messages: [...messages],
        tools: this.tools.size ? this.definitions : undefined,
        maxTokens: this.options.maxTokens,
        signal,
      })) {
        if (event.type === "text") {
          assistant.content += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "tool_call") {
          calls.push({ id: event.id, name: event.name, input: event.input });
        } else if (event.type === "usage") {
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          };
        } else if (event.type === "vendor") {
          vendor = { provider: event.provider, data: event.data };
        } else if (event.type === "end") {
          reason = event.reason;
        }
      }

      if (calls.length) {
        assistant.toolCalls = calls;
      }
      if (vendor) {
        assistant.vendor = vendor;
      }
      messages.push(assistant);
      yield {
        type: "message",
        message: assistant,
        usage: usage ?? { inputTokens: 0, outputTokens: 0 },
        model: this.modelName(),
      };

      if (!calls.length) {
        yield { type: "end", reason: reason === "tool" ? "stop" : reason };
        return;
      }

      const outcome = yield* this.runCalls(messages, calls, input.user);
      if (outcome === "paused") {
        yield { type: "end", reason: "paused" };
        return;
      }
    }

    yield { type: "end", reason: "length" };
  }

  /**
   * Run one step of a turn and collect it.
   */
  public async run(input: AiTurnInput): Promise<AiTurnResult> {
    const result: AiTurnResult = {
      messages: [],
      text: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: "stop",
    };
    for await (const event of this.stream(input)) {
      if (event.type === "message") {
        result.messages.push(event.message);
        if (event.message.role === "assistant") {
          result.text = event.message.content;
        }
        if (event.usage) {
          result.usage.inputTokens += event.usage.inputTokens;
          result.usage.outputTokens += event.usage.outputTokens;
        }
      } else if (event.type === "confirm" || event.type === "client_tool") {
        result.pending = {
          callId: event.callId,
          name: event.name,
          input: event.input,
          kind: event.type,
        };
      } else if (event.type === "end") {
        result.reason = event.reason;
      }
    }
    return result;
  }

  /**
   * The call the conversation is waiting on, read from the messages: the
   * first tool call of the last assistant message with no result yet.
   */
  public pendingOf(messages: AiMessage[]): AiPendingCall | undefined {
    const open = this.unanswered(messages)[0];
    if (!open) {
      return undefined;
    }
    const tool = this.tools.get(open.name);
    return {
      callId: open.id,
      name: open.name,
      input: open.input,
      kind: tool?.kind === "client" ? "client_tool" : "confirm",
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Apply a resume, then run the calls still open after it.
   */
  protected async *resumeCalls(
    messages: AiMessage[],
    input: AiTurnInput,
  ): AsyncGenerator<AiTurnEvent, "paused" | "done"> {
    const resume = input.resume!;
    const open = this.unanswered(messages);
    const call = open[0];
    if (!call || call.id !== resume.callId) {
      throw new AiConfigError(
        {},
        {
          message: `$ai '${this.name}': nothing waits on call '${resume.callId}'.`,
        },
      );
    }
    const tool = this.tools.get(call.name);

    let result: AiToolMessage;
    if ("decision" in resume) {
      if (tool?.kind !== "action") {
        throw new AiConfigError(
          {},
          {
            message: `$ai '${this.name}': call '${call.id}' is a client tool, it takes a result, not a decision.`,
          },
        );
      }
      result =
        resume.decision === "approve"
          ? await this.runAction(tool, call, input.user)
          : this.toolError(call, "Denied by the user.");
    } else {
      if (tool?.kind !== "client") {
        throw new AiConfigError(
          {},
          {
            message: `$ai '${this.name}': call '${call.id}' runs on the server, it takes a decision, not a result.`,
          },
        );
      }
      result = {
        role: "tool",
        callId: call.id,
        name: call.name,
        content: this.serializeResult(resume.result),
      };
    }

    messages.push(result);
    yield { type: "message", message: result };
    return yield* this.runCalls(messages, open.slice(1), input.user);
  }

  /**
   * Run `calls` in order, pausing on the first that needs the user.
   */
  protected async *runCalls(
    messages: AiMessage[],
    calls: AiToolCall[],
    user: UserAccountToken | undefined,
  ): AsyncGenerator<AiTurnEvent, "paused" | "done"> {
    for (const call of calls) {
      const tool = this.tools.get(call.name);
      if (tool?.kind === "client") {
        yield {
          type: "client_tool",
          callId: call.id,
          name: call.name,
          input: call.input,
        };
        return "paused";
      }
      if (tool && this.needsConfirmation(tool)) {
        yield {
          type: "confirm",
          callId: call.id,
          name: call.name,
          input: call.input,
        };
        return "paused";
      }

      yield {
        type: "tool_call",
        callId: call.id,
        name: call.name,
        input: call.input,
      };
      const result = tool
        ? await this.runAction(tool, call, user)
        : this.toolError(call, `Unknown tool '${call.name}'.`);
      messages.push(result);
      yield { type: "message", message: result };
    }
    return "done";
  }

  /**
   * Run an action as `user`, its own middlewares deciding. Every failure
   * becomes a tool error the model reads.
   */
  protected async runAction(
    tool: AiTool,
    call: AiToolCall,
    user: UserAccountToken | undefined,
  ): Promise<AiToolMessage> {
    if (tool.kind !== "action") {
      return this.toolError(call, `Tool '${call.name}' is not an action.`);
    }
    const input: Record<string, unknown> = {};
    for (const part of ["params", "query", "body"] as const) {
      if (tool.parts.includes(part) && call.input[part] !== undefined) {
        input[part] = call.input[part];
      }
    }
    try {
      const result = await tool.action.run(
        input as any,
        // `user` is how `run()` carries an identity (`alepha/security`);
        // without it the action runs anonymous, never as "system".
        { user } as any,
      );
      return {
        role: "tool",
        callId: call.id,
        name: call.name,
        content: this.serializeResult(result),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : "Error";
      return this.toolError(call, `${name}: ${message}`);
    }
  }

  protected toolError(call: AiToolCall, message: string): AiToolMessage {
    return {
      role: "tool",
      callId: call.id,
      name: call.name,
      content: message,
      isError: true,
    };
  }

  /**
   * A tool result as text for the model, capped so one large list cannot
   * fill the context window.
   */
  protected serializeResult(result: unknown): string {
    const text =
      typeof result === "string" ? result : JSON.stringify(result ?? null);
    const cap = 32 * 1024;
    return text.length > cap ? `${text.slice(0, cap)}...[truncated]` : text;
  }

  protected needsConfirmation(tool: AiTool): boolean {
    if (tool.kind !== "action") {
      return false;
    }
    const info = { name: tool.definition.name, method: tool.action.method };
    return this.options.confirm
      ? this.options.confirm(info)
      : info.method !== "GET";
  }

  /**
   * The tool calls of the last assistant message that have no result yet.
   */
  protected unanswered(messages: AiMessage[]): AiToolCall[] {
    let index = messages.length - 1;
    const answered = new Set<string>();
    while (index >= 0 && messages[index].role === "tool") {
      answered.add((messages[index] as AiToolMessage).callId);
      index--;
    }
    const last = messages[index];
    if (last?.role !== "assistant") {
      return [];
    }
    return (last.toolCalls ?? []).filter((call) => !answered.has(call.id));
  }

  protected signalOf(input: AiTurnInput): AbortSignal {
    const signals = [this.alepha.context.signal];
    if (input.signal) {
      signals.push(input.signal);
    }
    if (this.options.timeout !== undefined) {
      signals.push(
        AbortSignal.timeout(
          this.dateTime.duration(this.options.timeout).asMilliseconds(),
        ),
      );
    }
    return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  }

  protected modelName(): string {
    try {
      return this.provider.resolveModel({ model: this.options.model });
    } catch {
      return this.provider.name;
    }
  }

  protected toTool(tool: ActionPrimitive<any> | AiClientTool): AiTool {
    if ((tool as AiClientTool).kind === "client") {
      const client = tool as AiClientTool;
      this.toolSchema.assertName(client.name);
      return {
        kind: "client",
        definition: {
          name: client.name,
          description: client.description,
          inputSchema: this.toolSchema.toJsonSchema(client.schema),
        },
      };
    }

    const action = tool as ActionPrimitive<any>;
    this.toolSchema.assertName(action.name);
    const description = action.options.description;
    if (!description) {
      throw new AiConfigError(
        {},
        {
          message: `$ai '${this.name}': action '${action.name}' has no description, and a tool needs one: it is how the model knows when to call it.`,
        },
      );
    }
    const parts = (["params", "query", "body"] as const).filter(
      (part) => action.schema?.[part],
    );
    const properties: Record<string, unknown> = {};
    for (const part of parts) {
      properties[part] = this.toolSchema.toJsonSchema(action.schema![part]);
    }
    return {
      kind: "action",
      action,
      parts,
      definition: {
        name: action.name,
        description,
        inputSchema: {
          type: "object",
          properties,
          required: parts.filter((part) => part !== "query"),
          additionalProperties: false,
        },
      },
    };
  }
}

$ai[KIND] = AiPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

type AiTool =
  | {
      kind: "action";
      action: ActionPrimitive<any>;
      parts: Array<"params" | "query" | "body">;
      definition: AiToolDefinition;
    }
  | { kind: "client"; definition: AiToolDefinition };
