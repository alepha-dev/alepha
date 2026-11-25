import type { PrimitiveSide } from "alepha";
import {
  $inject,
  ActionToolSchema,
  AlephaError,
  createPrimitive,
  Primitive,
  type ZType,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { KIND } from "alepha/internal";
import type { McpContext, ToolPrimitive } from "alepha/mcp";
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

/**
 * What a call the user denied returns to the model, as a tool error. The
 * chat UI reads it back to tell a denial from a failure in a stored
 * conversation (`@alepha/ui`'s `useAiChat`), so it stays this exact text.
 */
export const AI_CALL_DENIED = "Denied by the user.";

/**
 * Appended to the last tool result before a turn's final model call, when
 * the turn's token bound is near.
 */
export const AI_TURN_WRAP_UP =
  "[This turn is out of tokens: answer the user now from what you already read. A further tool call will not run.]";

/**
 * The answer to a call the model asked for on a turn's final model call.
 */
export const AI_TURN_SPENT =
  "Not run: this turn is out of tokens. Answer from what you already read.";

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
 * - **A `$tool` is a tool too** (`alepha/mcp`), so a tool written for outside
 *   agents is offered to the assistant without a wrapper action. The model
 *   sees its `description` and `schema.params`; the call runs
 *   `tool.execute()` as the turn's user (its `use: [$secure(...)]` decides)
 *   with the turn's signal as `context.signal`. It is not an MCP call:
 *   `mcp:tool:call:end` does not fire.
 * - **Mutations wait for the user.** A call to a non-GET action, or to a
 *   `$tool` that is not `annotations.readOnlyHint` (or whatever `confirm`
 *   says), pauses the turn with a `confirm` event; a client tool (see
 *   {@link clientTool}) pauses with a `client_tool` event.
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
 * What `$ai({ tools })` takes: actions, MCP tools and client tools.
 */
export type AiToolList = Array<
  ActionPrimitive<any> | ToolPrimitive<any> | AiClientTool
>;

/**
 * A tool the browser runs (`navigate`, `fillForm`): calling it pauses the
 * turn with a `client_tool` event, and the result comes back on resume.
 */
export const clientTool = (
  name: string,
  options: { description: string; schema: ZType },
): AiClientTool => ({ kind: "client", name, ...options });

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options of {@link $ai}.
 */
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
   * The tools: `$action`s, `$tool`s (`alepha/mcp`), and client tools from
   * {@link clientTool}.
   *
   * An action takes `{ params, query, body }` for the parts it declares; a
   * `$tool` takes its own `schema.params`. Both run as the turn's user.
   *
   * A function is called once, on the first turn (or the first read of
   * `definitions`), instead of when the class is created. Use it when the
   * tools live on classes the app should not create at boot: the classes
   * holding them are then created on that first use.
   */
  tools?: AiToolList | (() => AiToolList);

  /**
   * The tools this user is offered on a turn, by name: what the model sees.
   * A name outside the list is neither sent to the vendor nor run if the
   * model calls it anyway (it gets a tool error). Return `undefined` to offer
   * every tool. A turn's own `tools` wins over this.
   *
   * It narrows what the model is shown, it is not the security boundary:
   * every action still runs its own `use: [$secure(...)]`.
   *
   * `context` is the turn's page context, on a chat and on a resume alike,
   * so an app can offer per page what the user may do there (the tools of
   * the project they are looking at). ⚠️ It is client-supplied: it narrows
   * what the model is shown and is never a security input, since every
   * tool still runs its own gate.
   *
   * @example
   * ```ts
   * allow: ({ user }) => user?.roles?.includes("admin") ? undefined : ["list"],
   * ```
   */
  allow?: (ctx: {
    user?: UserAccountToken;
    context?: AiPageContext;
  }) => string[] | undefined | Promise<string[] | undefined>;

  /**
   * Whether a call to this tool waits for the user's approval. `method` is
   * the action's HTTP method, or `"TOOL"` for a `$tool`. Default: every
   * action whose method is not GET, and every `$tool` that is not
   * `annotations.readOnlyHint: true`.
   */
  confirm?: (tool: { name: string; method: string }) => boolean;

  /**
   * Model calls per turn before the loop stops with `end: length`.
   *
   * @default 10
   */
  maxSteps?: number;

  /**
   * Tokens (input plus output, summed over the model calls) one turn may
   * spend. Every model call resends the system prompt, the tool definitions
   * and the whole conversation, so a turn of eight tool calls costs about
   * eight times its context. When the next call would cross this bound, the
   * last tool results tell the model to answer, and that call is the turn's
   * last: a call it still asks for is answered with an error, never run,
   * and the turn ends with `end: length`. A turn's own `tokenBudget` lowers
   * it.
   *
   * Unset: no bound but `maxSteps`.
   */
  turnTokens?: number;

  /**
   * Calls of one tool a turn may make. A call past it is answered with an
   * error telling the model to work with what it has, and not run. An
   * identical call (same tool, same input) is never run twice in a turn,
   * whatever this is: the second is answered with a pointer to the first.
   *
   * Unset: no cap.
   */
  maxCallsPerTool?: number;

  /**
   * Characters of one tool result the model reads; the rest is cut with
   * `...[truncated]`. A result is resent on every later call of the turn,
   * so this bounds the cost of a large read.
   *
   * @default 32768
   */
  maxResultLength?: number;

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
   * The page the user is on: appended to their new message, and passed to
   * the `allow` option. A resume appends nothing, but should carry the
   * context of the turn it continues, so `allow` offers the same tools and
   * the approved call is still offered (client-supplied either way).
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
   * The tools offered on this turn, by name; the rest are neither sent to
   * the model nor run. Wins over the `allow` option. Omitted: `allow`
   * decides, and without it every tool is offered.
   */
  tools?: string[];

  /**
   * Tokens this turn may still spend, such as what is left of the user's
   * budget: the turn wraps up before crossing it, as with the `turnTokens`
   * option, and the lower of the two wins.
   */
  tokenBudget?: number;

  /**
   * The model for this turn, instead of the `model` option: a persona that
   * runs on a cheaper or a stronger model than the app's default. The model
   * each assistant message was answered by is reported on its `message`
   * event.
   *
   * ⚠️ Server-side only: never fill it from a request body, or any user
   * picks the model their budget pays for.
   */
  model?: string;

  /**
   * Text appended after the system prompt for this turn: a persona and its
   * playbook. The system prompt is never replaced, so its rules still hold;
   * it stays one cacheable prefix per set of instructions.
   *
   * ⚠️ Server-side only: never fill it from a request body, or any user
   * writes their own system prompt. A resume needs the instructions of the
   * turn it continues.
   */
  instructions?: string;

  /**
   * Cancels the turn. Combined with the ambient signal and `timeout`.
   */
  signal?: AbortSignal;
}

/**
 * The answer that resumes a paused turn: a decision on a confirmation, or a
 * client tool's result.
 */
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
 * What one `stream()` has called so far: the first call id of each tool and
 * input, and the calls of each tool.
 */
export interface AiCallLedger {
  results: Map<string, string>;
  counts: Map<string, number>;
}

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
  /**
   * `boot` for the pure controller rule: read by the AI provider at start.
   */
  public static override readonly side: PrimitiveSide = "boot";

  protected readonly provider = $inject(AiProvider);
  protected readonly toolSchema = $inject(AiToolSchema);
  protected readonly actionToolSchema = $inject(ActionToolSchema);
  protected readonly contextBlock = $inject(AiContextBlock);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The tools by name, with their vendor definitions. Built and checked at
   * init when `tools` is a list, so a bad name or a missing description fails
   * at start; on first use when it is a function.
   */
  protected built?: Map<string, AiTool>;

  protected get tools(): Map<string, AiTool> {
    this.built ??= this.buildTools();
    return this.built;
  }

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
    if (typeof this.options.tools !== "function") {
      this.built = this.buildTools();
    }
  }

  protected buildTools(): Map<string, AiTool> {
    const tools = new Map<string, AiTool>();
    const list =
      typeof this.options.tools === "function"
        ? this.options.tools()
        : (this.options.tools ?? []);
    for (const tool of list) {
      const entry = this.toTool(tool);
      if (tools.has(entry.definition.name)) {
        throw new AiConfigError(
          {},
          {
            message: `$ai '${this.name}': two tools are named '${entry.definition.name}'.`,
          },
        );
      }
      tools.set(entry.definition.name, entry);
    }
    return tools;
  }

  /**
   * Run one step of a turn: until the model stops, a call needs the user, or
   * a bound is hit.
   */
  public async *stream(input: AiTurnInput): AsyncIterable<AiTurnEvent> {
    const signal = this.signalOf(input);
    const messages = [...input.messages];
    const offered = await this.offeredTo(input);
    const ledger: AiCallLedger = { results: new Map(), counts: new Map() };
    const base =
      typeof this.options.system === "function"
        ? this.options.system({ user: input.user })
        : this.options.system;
    const system = input.instructions?.trim()
      ? `${base}\n\n${input.instructions.trim()}`
      : base;
    const model = input.model?.trim() || this.options.model;

    if (input.resume) {
      const outcome = yield* this.resumeCalls(messages, input, offered, ledger);
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
    const limit = this.turnLimit(input);
    let spent = 0;
    let final = false;
    for (let step = 0; step < maxSteps; step++) {
      signal.throwIfAborted();
      const assistant: AiAssistantMessage = { role: "assistant", content: "" };
      const calls: AiToolCall[] = [];
      let usage: AiUsage | undefined;
      let vendor: AiVendorData | undefined;
      let reason: AiEndReason = "stop";

      for await (const event of this.provider.chat({
        model,
        system,
        // A copy: the loop appends to its own list, and a provider (or a
        // spec recording requests) must see the conversation as it was sent.
        messages: [...messages],
        tools: offered.length ? offered : undefined,
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
            ...(event.cachedInputTokens
              ? { cachedInputTokens: event.cachedInputTokens }
              : {}),
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
        model: this.modelName(model),
      };

      if (!calls.length) {
        yield { type: "end", reason: reason === "tool" ? "stop" : reason };
        return;
      }

      if (final) {
        // The model was told to answer and called a tool anyway: every call
        // gets an answer (an open call would read as a pause), none runs.
        for (const call of calls) {
          const refused = this.toolError(call, AI_TURN_SPENT);
          messages.push(refused);
          yield { type: "message", message: refused };
        }
        yield { type: "end", reason: "length" };
        return;
      }

      // The next call resends at least what this one read: when that would
      // cross the bound, it is the last one, and the results say so.
      // A last call that crosses the bound overshoots it by one call at
      // most, which buys the answer.
      const cost = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
      spent += cost;
      final = limit !== undefined && spent + cost * 2 > limit;

      const outcome = yield* this.runCalls(
        messages,
        calls,
        input.user,
        offered,
        signal,
        ledger,
        final ? AI_TURN_WRAP_UP : undefined,
      );
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
    offered: AiToolDefinition[],
    ledger?: AiCallLedger,
  ): AsyncGenerator<AiTurnEvent, "paused" | "done"> {
    const resume = input.resume!;
    const signal = this.signalOf(input);
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
    const available = this.isOffered(call.name, offered);

    let result: AiToolMessage;
    if (!available) {
      result = this.unavailable(call);
    } else if ("decision" in resume) {
      if (tool?.kind !== "action" && tool?.kind !== "tool") {
        throw new AiConfigError(
          {},
          {
            message: `$ai '${this.name}': call '${call.id}' is a client tool, it takes a result, not a decision.`,
          },
        );
      }
      result =
        resume.decision === "approve"
          ? await this.runAction(tool, call, input.user, signal)
          : this.toolError(call, AI_CALL_DENIED);
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
    return yield* this.runCalls(
      messages,
      open.slice(1),
      input.user,
      offered,
      signal,
      ledger,
    );
  }

  /**
   * Run `calls` in order, pausing on the first that needs the user.
   */
  protected async *runCalls(
    messages: AiMessage[],
    calls: AiToolCall[],
    user: UserAccountToken | undefined,
    offered: AiToolDefinition[] = this.definitions,
    signal: AbortSignal = this.alepha.context.signal,
    ledger: AiCallLedger = { results: new Map(), counts: new Map() },
    note?: string,
  ): AsyncGenerator<AiTurnEvent, "paused" | "done"> {
    for (const [index, call] of calls.entries()) {
      if (this.tools.has(call.name) && !this.isOffered(call.name, offered)) {
        const refused = this.unavailable(call);
        messages.push(refused);
        yield { type: "message", message: refused };
        continue;
      }
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
      const result =
        this.repeated(call, ledger) ??
        (tool
          ? await this.runAction(tool, call, user, signal)
          : this.toolError(call, `Unknown tool '${call.name}'.`));
      if (note && index === calls.length - 1) {
        result.content = `${result.content}\n\n${note}`;
      }
      messages.push(result);
      yield { type: "message", message: result };
    }
    return "done";
  }

  /**
   * The answer to a call the turn already made with the same input, or past
   * `maxCallsPerTool`: never run again. `undefined` for a call to run, which
   * is then counted.
   */
  protected repeated(
    call: AiToolCall,
    ledger: AiCallLedger,
  ): AiToolMessage | undefined {
    const key = `${call.name}:${this.stableJson(call.input)}`;
    const earlier = ledger.results.get(key);
    if (earlier) {
      return {
        role: "tool",
        callId: call.id,
        name: call.name,
        content: `Same call, same input as call '${earlier}' earlier in this turn: not run again. Read its result above.`,
      };
    }
    const count = ledger.counts.get(call.name) ?? 0;
    const cap = this.options.maxCallsPerTool;
    if (cap !== undefined && count >= cap) {
      return this.toolError(
        call,
        `Not run: '${call.name}' was already called ${count} times this turn. Answer from what those calls returned.`,
      );
    }
    ledger.results.set(key, call.id);
    ledger.counts.set(call.name, count + 1);
    return undefined;
  }

  /**
   * JSON with object keys sorted, so two inputs differing only in key order
   * are one call.
   */
  protected stableJson(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, it) =>
      it && typeof it === "object" && !Array.isArray(it)
        ? Object.fromEntries(
            Object.keys(it)
              .sort()
              .map((key) => [key, it[key]]),
          )
        : it,
    );
  }

  /**
   * The tokens a turn may spend: the lower of the `turnTokens` option and
   * the turn's `tokenBudget`, or `undefined` for neither.
   */
  protected turnLimit(input: AiTurnInput): number | undefined {
    const bounds = [this.options.turnTokens, input.tokenBudget].filter(
      (it): it is number => typeof it === "number",
    );
    return bounds.length ? Math.min(...bounds) : undefined;
  }

  /**
   * Run an action or a `$tool` as `user`, its own middlewares deciding. Every
   * failure becomes a tool error the model reads.
   */
  protected async runAction(
    tool: AiTool,
    call: AiToolCall,
    user: UserAccountToken | undefined,
    signal: AbortSignal = this.alepha.context.signal,
  ): Promise<AiToolMessage> {
    if (tool.kind === "tool") {
      return this.runMcpTool(tool, call, user, signal);
    }
    if (tool.kind !== "action") {
      return this.toolError(call, `Tool '${call.name}' is not an action.`);
    }
    try {
      // Inside the `try`: a model may send an input that is not an object
      // (`arguments: "null"`), and reading a part off it is a tool error the
      // model reads, not a crash of the whole turn.
      if (!call.input || typeof call.input !== "object") {
        throw new TypeError(
          `Tool input must be an object, got ${call.input === null ? "null" : typeof call.input}.`,
        );
      }
      const input: Record<string, unknown> = {};
      for (const part of ["params", "query", "body"] as const) {
        if (tool.parts.includes(part) && call.input[part] !== undefined) {
          input[part] = call.input[part];
        }
      }
      const result = await this.asUser(user, () =>
        tool.action.run(
          input as any,
          // `user` is how `run()` carries an identity (`alepha/security`);
          // without it the action runs anonymous, never as "system".
          { user },
        ),
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

  /**
   * Run `fn` in a fork whose only identity is `user`.
   *
   * With a user, the fork sets the current user, the same thing
   * `run({ user })` does for an action, so `$secure` and
   * `ToolPrimitive.currentUser()` see that user. Without one it hides BOTH
   * slots they read: the current-user atom and the HTTP request (whose user
   * or credentials they fall back to). Clearing nothing ran a turn called
   * without `user` from inside a signed-in request as that request's user.
   */
  protected asUser<R>(user: UserAccountToken | undefined, fn: () => R): R {
    // `currentUserAtom.key` (`alepha/security`), spelled out: alepha/ai
    // imports that module as types only.
    return this.alepha.fork(
      fn,
      user
        ? { "alepha.security.user": user }
        : {
            "alepha.security.user": undefined,
            "alepha.http.request": undefined,
          },
    );
  }

  /**
   * Run a `$tool` as `user` (see {@link asUser}): without one a `$secure`
   * tool refuses. The turn's signal is the tool's `context.signal` and its
   * ambient signal.
   */
  protected async runMcpTool(
    tool: Extract<AiTool, { kind: "tool" }>,
    call: AiToolCall,
    user: UserAccountToken | undefined,
    signal: AbortSignal,
  ): Promise<AiToolMessage> {
    try {
      const context: McpContext = { signal };
      const result = await this.alepha.context.withSignal(signal, () =>
        this.asUser(user, () => tool.tool.execute(call.input, context)),
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

  /**
   * The definitions offered on a turn: every tool, narrowed by the turn's
   * `tools` or else by the `allow` option. Declaration order is kept, so the
   * vendor still caches a stable list.
   */
  protected async offeredTo(input: AiTurnInput): Promise<AiToolDefinition[]> {
    const names =
      input.tools ??
      (this.options.allow
        ? await this.options.allow({
            user: input.user,
            context: input.context,
          })
        : undefined);
    if (!names) {
      return this.definitions;
    }
    const allowed = new Set(names);
    return this.definitions.filter((tool) => allowed.has(tool.name));
  }

  protected isOffered(name: string, offered: AiToolDefinition[]): boolean {
    return offered.some((tool) => tool.name === name);
  }

  /**
   * The answer to a call of a tool this turn did not offer: it is never run.
   */
  protected unavailable(call: AiToolCall): AiToolMessage {
    return this.toolError(
      call,
      `Tool '${call.name}' is not available to this user.`,
    );
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
   * A tool result as text for the model, capped at `maxResultLength` so one
   * large list cannot fill the context window.
   */
  protected serializeResult(result: unknown): string {
    const text =
      typeof result === "string" ? result : JSON.stringify(result ?? null);
    const cap = this.options.maxResultLength ?? 32 * 1024;
    return text.length > cap ? `${text.slice(0, cap)}...[truncated]` : text;
  }

  protected needsConfirmation(tool: AiTool): boolean {
    if (tool.kind === "client") {
      return false;
    }
    if (tool.kind === "tool") {
      const info = { name: tool.definition.name, method: "TOOL" };
      return this.options.confirm
        ? this.options.confirm(info)
        : tool.tool.options.annotations?.readOnlyHint !== true;
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

  protected modelName(model = this.options.model): string {
    try {
      return this.provider.resolveModel({ model });
    } catch {
      return this.provider.name;
    }
  }

  /**
   * Whether `tool` is a `$tool`, told apart by shape: alepha/ai imports
   * alepha/mcp as types only, so an app with `$ai` and no MCP never loads
   * `McpServerProvider`.
   */
  protected isMcpTool(tool: unknown): tool is ToolPrimitive<any> {
    const it = tool as Partial<ToolPrimitive<any>> | undefined;
    return (
      typeof it?.execute === "function" &&
      typeof it?.toDescriptor === "function"
    );
  }

  protected toTool(
    tool: ActionPrimitive<any> | ToolPrimitive<any> | AiClientTool,
  ): AiTool {
    if (this.isMcpTool(tool)) {
      this.toolSchema.assertName(tool.name);
      const params = tool.options.schema?.params;
      return {
        kind: "tool",
        tool,
        definition: {
          name: tool.name,
          description: tool.description,
          inputSchema: params
            ? this.actionToolSchema.toJsonSchema(params)
            : { type: "object", properties: {} },
        },
      };
    }

    if ((tool as AiClientTool).kind === "client") {
      const client = tool as AiClientTool;
      this.toolSchema.assertName(client.name);
      return {
        kind: "client",
        definition: {
          name: client.name,
          description: client.description,
          inputSchema: this.actionToolSchema.toJsonSchema(client.schema),
        },
      };
    }

    const action = tool as ActionPrimitive<any>;
    this.toolSchema.assertName(action.name);
    let built: ReturnType<ActionToolSchema["fromAction"]>;
    try {
      built = this.actionToolSchema.fromAction(action);
    } catch (error) {
      if (error instanceof AlephaError) {
        throw new AiConfigError(
          {},
          { message: `$ai '${this.name}': ${error.message}`, cause: error },
        );
      }
      throw error;
    }
    return {
      kind: "action",
      action,
      parts: built.parts,
      definition: {
        name: built.name,
        description: built.description,
        inputSchema: built.inputSchema,
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
  | { kind: "tool"; tool: ToolPrimitive<any>; definition: AiToolDefinition }
  | { kind: "client"; definition: AiToolDefinition };
