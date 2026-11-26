/*
 * Browser-loadable: the job page parses a job's log with it (#Q4286). Pure,
 * no I/O, so its spec feeds it recorded logs of real jobs.
 */

/**
 * One tool call of a run, as the job page and the chat traces draw it: its
 * name, the short of its input, the input in full and its result.
 */
export interface AgentTranscriptTool {
  id: string;
  name: string;
  /**
   * The command, the file path, or the Lore tool's main argument.
   */
  detail?: string;
  input: string;
  result?: string;
  state: "running" | "done" | "failed";
}

export type AgentTranscriptEntry =
  | { kind: "session"; model?: string; cwd?: string }
  | { kind: "text"; text: string }
  /**
   * A message a member sent the running job (#Q4456), as the agent CLI
   * replayed it when it read it. The job's page names who sent it.
   */
  | { kind: "message"; text: string }
  | { kind: "tools"; tools: AgentTranscriptTool[] }
  | { kind: "limit"; text: string }
  | { kind: "raw"; line: string };

/**
 * What the run reported at its end: turns, tokens and cost, and its error.
 */
export interface AgentTranscriptTotals {
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

export interface AgentTranscriptResult {
  entries: AgentTranscriptEntry[];
  /**
   * Bookkeeping events left out, by type: shown on demand.
   */
  hidden: number;
  totals?: AgentTranscriptTotals;
  /**
   * Whether the agent CLI has a parser: without one, every line is raw.
   */
  parsed: boolean;
  /**
   * The lines a parser could not read (#Q4296), one entry per kind: an
   * event `type` it does not know, `unparsable` for a line that is not
   * JSON, `not-an-object` for JSON that is not an event. Never drawn: the
   * server logs them once, at the job's end. `sample` is the first line's
   * start, never the whole line.
   */
  unknown?: Array<{ kind: string; count: number; sample: string }>;
}

/**
 * A job's log as a conversation (#Q4286): what the agent said, each tool
 * call on one line with its folded result, the session's start, and the
 * run's totals. One parser per agent CLI, keyed by the job's agent; a CLI
 * with none shows its lines as text.
 *
 * - **Hidden**: bookkeeping events, from {@link HIDDEN}, counted. A rate
 *   limit that stopped the run is shown.
 * - **Never raw JSON** (#Q4296): a line that is not JSON, or an event type
 *   the parser does not know, is left out of the view and counted in
 *   `unknown`, which the server logs as an error at the job's end. The
 *   log's last line, while it has no newline, is an event still arriving
 *   on a running job (its log is read by byte offsets): it is neither shown
 *   nor counted until it ends (#Q4323).
 * - **Never binary**: an image or any other non-text block in a tool
 *   result reads as `[image]`, never as its base64.
 */
export class AgentTranscript {
  /**
   * Claude Code's bookkeeping events, left out of the transcript.
   */
  public static readonly HIDDEN = new Set([
    "rate_limit_event",
    "thinking_tokens",
    "stream_event",
    "keep_alive",
    // A long tool call's heartbeat, every 30 s: the call already shows as
    // running (#Q4296).
    "tool_progress",
  ]);

  public static parse(log: string, agent?: string): AgentTranscriptResult {
    if (agent && agent !== "claude") {
      return {
        entries: AgentTranscript.lines(log).map((line) => ({
          kind: "raw" as const,
          line,
        })),
        hidden: 0,
        parsed: false,
      };
    }
    return AgentTranscript.claude(log);
  }

  /**
   * The model the agent CLI reported at its start (#Q4304): Claude Code's
   * `system` / `init` event. Reads lines only until it, which is the first
   * event of a run, so a long log costs one line.
   */
  public static sessionModel(log: string, agent?: string): string | undefined {
    if (agent && agent !== "claude") return undefined;
    for (const line of AgentTranscript.lines(log)) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        continue;
      }
      const record = event as Record<string, unknown>;
      if (record.type === "system" && record.subtype === "init") {
        return typeof record.model === "string" && record.model
          ? record.model
          : undefined;
      }
    }
    return undefined;
  }

  protected static lines(log: string): string[] {
    return log.split("\n").filter((line) => line.trim() !== "");
  }

  /**
   * Claude Code's `--output-format stream-json`: one event per line.
   */
  protected static claude(log: string): AgentTranscriptResult {
    const entries: AgentTranscriptEntry[] = [];
    const byId = new Map<string, AgentTranscriptTool>();
    let hidden = 0;
    let totals: AgentTranscriptTotals | undefined;
    const unknown = new Map<
      string,
      { kind: string; count: number; sample: string }
    >();
    const miss = (kind: string, line: string) => {
      const seen = unknown.get(kind);
      if (seen) {
        seen.count++;
        return;
      }
      unknown.set(kind, { kind, count: 1, sample: line.slice(0, 200) });
    };
    const tools = (): AgentTranscriptTool[] => {
      const last = entries.at(-1);
      if (last?.kind === "tools") return last.tools;
      const fresh: AgentTranscriptEntry = { kind: "tools", tools: [] };
      entries.push(fresh);
      return fresh.tools;
    };

    // A run that takes messages replays every user message it reads
    // (#Q4456): its prompt first, which the Prompt tab already shows.
    let prompted = false;
    const lines = AgentTranscript.lines(log);
    const arriving = !log.endsWith("\n");
    for (const [index, line] of lines.entries()) {
      let event: Record<string, any>;
      try {
        event = JSON.parse(line);
      } catch {
        // The last line, cut where the read stopped: the next read ends it.
        if (arriving && index === lines.length - 1) continue;
        miss("unparsable", line);
        continue;
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        miss("not-an-object", line);
        continue;
      }
      const type = String(event.type ?? "");
      if (type === "rate_limit_event") {
        const status = event.rate_limit_info?.status;
        if (status && status !== "allowed") {
          entries.push({
            kind: "limit",
            text: `Rate limit: ${status}`,
          });
        } else {
          hidden++;
        }
        continue;
      }
      if (AgentTranscript.HIDDEN.has(type)) {
        hidden++;
        continue;
      }
      if (type === "system") {
        if (event.subtype === "init") {
          entries.push({
            kind: "session",
            ...(event.model ? { model: String(event.model) } : {}),
            ...(event.cwd ? { cwd: String(event.cwd) } : {}),
          });
        } else {
          hidden++;
        }
        continue;
      }
      if (type === "assistant") {
        const content = Array.isArray(event.message?.content)
          ? event.message.content
          : [];
        for (const part of content) {
          if (part?.type === "text" && String(part.text ?? "").trim()) {
            entries.push({ kind: "text", text: String(part.text) });
          } else if (part?.type === "tool_use") {
            const tool: AgentTranscriptTool = {
              id: String(part.id ?? ""),
              name: String(part.name ?? "tool"),
              input: JSON.stringify(part.input ?? {}, null, 2),
              state: "running",
            };
            const detail = AgentTranscript.detailOf(part.input);
            if (detail) tool.detail = detail;
            tools().push(tool);
            if (tool.id) byId.set(tool.id, tool);
          }
          // A thinking block carries no readable text: nothing to show.
        }
        continue;
      }
      if (type === "user") {
        // Claude Code's own user lines (a skill's text, a compaction
        // summary) are no member's message.
        const own =
          event.isMeta === true ||
          event.isSynthetic === true ||
          event.isCompactSummary === true;
        const said = own
          ? undefined
          : AgentTranscript.userText(event.message?.content);
        if (own && !Array.isArray(event.message?.content)) continue;
        if (said !== undefined) {
          if (prompted) entries.push({ kind: "message", text: said });
          prompted = true;
          continue;
        }
        const content = Array.isArray(event.message?.content)
          ? event.message.content
          : [];
        for (const part of content) {
          if (part?.type !== "tool_result") continue;
          const tool = byId.get(String(part.tool_use_id ?? ""));
          if (!tool) continue;
          tool.result = AgentTranscript.textOf(part.content);
          tool.state = part.is_error ? "failed" : "done";
        }
        continue;
      }
      if (type === "result") {
        totals = {
          ...(typeof event.num_turns === "number"
            ? { turns: event.num_turns }
            : {}),
          ...(typeof event.usage?.input_tokens === "number"
            ? {
                inputTokens:
                  event.usage.input_tokens +
                  (event.usage.cache_creation_input_tokens ?? 0) +
                  (event.usage.cache_read_input_tokens ?? 0),
              }
            : {}),
          ...(typeof event.usage?.output_tokens === "number"
            ? { outputTokens: event.usage.output_tokens }
            : {}),
          ...(typeof event.total_cost_usd === "number"
            ? { costUsd: event.total_cost_usd }
            : {}),
          ...(event.is_error
            ? { error: String(event.result ?? event.subtype ?? "error") }
            : {}),
        };
        continue;
      }
      miss(type || "untyped", line);
    }
    return {
      entries,
      hidden,
      ...(totals ? { totals } : {}),
      parsed: true,
      ...(unknown.size ? { unknown: [...unknown.values()] } : {}),
    };
  }

  /**
   * A user line's words, when it is a message rather than tool results:
   * a string, or text blocks only.
   */
  protected static userText(content: unknown): string | undefined {
    if (typeof content === "string") return content;
    if (!Array.isArray(content) || content.length === 0) return undefined;
    if (!content.every((it) => it?.type === "text")) return undefined;
    return content.map((it) => String(it.text ?? "")).join("\n");
  }

  /**
   * The short of a tool's input: its command, its path, or its first short
   * string argument.
   */
  protected static detailOf(input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const record = input as Record<string, unknown>;
    for (const key of [
      "command",
      "file_path",
      "path",
      "pattern",
      "url",
      "query",
      "description",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return AgentTranscript.shorten(value);
      }
    }
    const first = Object.entries(record).find(
      ([, value]) => typeof value === "string" || typeof value === "number",
    );
    return first
      ? AgentTranscript.shorten(`${first[0]}: ${String(first[1])}`)
      : undefined;
  }

  protected static shorten(text: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }

  /**
   * A tool result's text: a string, or a list of text blocks. A block with
   * no text (an image, a document) is named by its type, never printed:
   * its base64 is not something a person reads (#Q4323).
   */
  protected static textOf(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((it) => {
          if (!it || typeof it !== "object") return JSON.stringify(it);
          const block = it as { type?: unknown; text?: unknown };
          if (typeof block.text === "string") return block.text;
          if (typeof block.type === "string") return `[${block.type}]`;
          return JSON.stringify(it);
        })
        .join("\n");
    }
    return content === undefined ? "" : JSON.stringify(content);
  }
}
