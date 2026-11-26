import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import { AgentTranscript } from "../src/api/schemas/AgentTranscript.ts";

const log = (name: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/agent-logs", name),
    "utf8",
  );

/**
 * A job's log read as a conversation (#Q4286), fed from a recorded log of a
 * real Claude Code job (trimmed of its tool list and signatures): the
 * session, each tool call with its folded result, what the agent said, the
 * totals, the bookkeeping hidden, and nothing dropped.
 */
describe("AgentTranscript", () => {
  it("reads a Claude Code stream: the session, a tool call with its result, the reply and the totals", ({
    expect,
  }) => {
    const out = AgentTranscript.parse(log("claude-read-job.jsonl"), "claude");
    expect(out.parsed).toBe(true);
    expect(out.entries.map((it) => it.kind)).toEqual([
      "session",
      "tools",
      "text",
    ]);
    expect(out.entries[0]).toEqual({
      kind: "session",
      model: "claude-opus-5-5",
      cwd: "/home/bay-agent/bay-jobs/alepha/text",
    });
    const tools = out.entries[1];
    expect(tools?.kind === "tools" && tools.tools[0]).toMatchObject({
      name: "Bash",
      state: "done",
      detail: expect.stringContaining("git -C src rev-parse HEAD"),
      result: expect.stringContaining("FAILED"),
    });
    expect(out.entries[2]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("Nothing was written to Lore."),
    });
    // The allowed rate limit is bookkeeping.
    expect(out.hidden).toBe(1);
    expect(out.totals).toEqual({
      turns: 2,
      inputTokens: 4 + 8856 + 32025,
      outputTokens: 377,
      costUsd: 0.08480900000000001,
    });
  });

  it("marks an error result, shows a rate limit that stopped the run, and counts a line it cannot read without drawing it", ({
    expect,
  }) => {
    const out = AgentTranscript.parse(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "mcp__lore__quest_get",
                input: { shortId: 12 },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "text", text: "Quest not found" }],
                is_error: true,
              },
            ],
          },
        }),
        "panic: something odd",
        JSON.stringify({ type: "brand_new_event", data: 1 }),
        JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected" },
        }),
        JSON.stringify({
          type: "result",
          is_error: true,
          subtype: "error_max_turns",
        }),
      ].join("\n"),
      "claude",
    );
    const [tools, limit] = out.entries;
    expect(tools?.kind === "tools" && tools.tools[0]).toMatchObject({
      name: "mcp__lore__quest_get",
      detail: "shortId: 12",
      state: "failed",
      result: "Quest not found",
    });
    // Never drawn raw (#Q4296): counted by kind, for the server to log.
    expect(out.entries.map((it) => it.kind)).toEqual(["tools", "limit"]);
    expect(out.unknown).toEqual([
      { kind: "unparsable", count: 1, sample: "panic: something odd" },
      {
        kind: "brand_new_event",
        count: 1,
        sample: JSON.stringify({ type: "brand_new_event", data: 1 }),
      },
    ]);
    expect(limit).toEqual({ kind: "limit", text: "Rate limit: rejected" });
    expect(out.totals?.error).toBe("error_max_turns");
  });

  it("names an image in a tool result instead of printing its base64, and waits for a last line still arriving (#Q4323)", ({
    expect,
  }) => {
    const base64 = "iVBORw0KGgo".repeat(2000);
    const use = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "mcp__lore__feedback_attachment_get",
            input: { id: 7 },
          },
        ],
      },
    });
    const result = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "text", text: "screenshot.png" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64,
                },
              },
            ],
          },
        ],
      },
    });

    const whole = AgentTranscript.parse(`${use}\n${result}\n`, "claude");
    const [tools] = whole.entries;
    expect(whole.entries).toHaveLength(1);
    expect(tools?.kind === "tools" && tools.tools[0]?.result).toBe(
      "screenshot.png\n[image]",
    );

    // Read while the result's line was still being written: it is not
    // shown until it ends.
    const cut = AgentTranscript.parse(
      `${use}\n${result.slice(0, 5000)}`,
      "claude",
    );
    expect(cut.entries.map((it) => it.kind)).toEqual(["tools"]);
    expect(JSON.stringify(cut.entries)).not.toContain("iVBORw0KGgo");

    // Ended, a line that is not JSON is counted, never drawn (#Q4296).
    const ended = AgentTranscript.parse(
      `${use}\n${result.slice(0, 5000)}\n`,
      "claude",
    );
    expect(ended.entries.map((it) => it.kind)).toEqual(["tools"]);
    expect(ended.unknown).toEqual([
      { kind: "unparsable", count: 1, sample: result.slice(0, 200) },
    ]);
  });

  it("reads a line whose image body Bay replaced by a placeholder as an image, with no unknown line (#Q4455)", ({
    expect,
  }) => {
    const use = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      },
    });
    const result = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "[image/png, 855 KB]",
                },
              },
            ],
          },
        ],
      },
      tool_use_result: {
        type: "image",
        file: { base64: "[image/png, 855 KB]", type: "image/png" },
      },
    });
    const out = AgentTranscript.parse(`${use}\n${result}\n`, "claude");
    const [tools] = out.entries;
    expect(tools?.kind === "tools" && tools.tools[0]?.result).toBe("[image]");
    expect(out.unknown).toBeUndefined();
  });

  it("reads the messages a member sent a running job as message entries, after the prompt it replays first (#Q4456)", ({
    expect,
  }) => {
    const user = (content: unknown) =>
      JSON.stringify({ type: "user", message: { role: "user", content } });
    const log = [
      user("Triage the inbox."),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Waiting on the watcher." }],
        },
      }),
      user("Wake up."),
      user([{ type: "text", text: "Read the state yourself." }]),
      // Claude Code's own user lines are no member's message.
      JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content: "Skill text." },
      }),
      "",
    ].join("\n");
    const out = AgentTranscript.parse(log, "claude");
    expect(out.entries).toEqual([
      { kind: "text", text: "Waiting on the watcher." },
      { kind: "message", text: "Wake up." },
      { kind: "message", text: "Read the state yourself." },
    ]);
    expect(out.unknown).toBeUndefined();
  });

  it("drops tool_progress heartbeats silently, and counts a repeated unknown kind once, with its first line as the sample (#Q4296)", ({
    expect,
  }) => {
    const heartbeat = (seconds: number) =>
      JSON.stringify({
        type: "tool_progress",
        tool_name: "Bash",
        elapsed_time_seconds: seconds,
        heartbeat: true,
      });
    const odd = (n: number) => JSON.stringify({ type: "odd_event", n });
    const out = AgentTranscript.parse(
      [heartbeat(30), odd(1), heartbeat(60), odd(2), "[1,2]", ""].join("\n"),
      "claude",
    );
    expect(out.entries).toEqual([]);
    expect(out.hidden).toBe(2);
    expect(out.unknown).toEqual([
      { kind: "odd_event", count: 2, sample: odd(1) },
      { kind: "not-an-object", count: 1, sample: "[1,2]" },
    ]);
  });

  it("shows every line as text for an agent CLI with no parser", ({
    expect,
  }) => {
    const out = AgentTranscript.parse('{"type":"message"}\nplain\n', "gemini");
    expect(out.parsed).toBe(false);
    expect(out.entries).toEqual([
      { kind: "raw", line: '{"type":"message"}' },
      { kind: "raw", line: "plain" },
    ]);
  });

  it("reads the model the agent CLI reported at its start, for a run that named none (#Q4304)", ({
    expect,
  }) => {
    const log = [
      "warming up",
      JSON.stringify({ type: "system", subtype: "init", model: "m-default" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n");
    expect(AgentTranscript.sessionModel(log, "claude")).toBe("m-default");
    expect(AgentTranscript.sessionModel(log)).toBe("m-default");
    expect(AgentTranscript.sessionModel("no init here\n", "claude")).toBe(
      undefined,
    );
    expect(AgentTranscript.sessionModel(log, "gemini")).toBe(undefined);
  });
});
