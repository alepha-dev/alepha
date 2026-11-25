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

  it("marks an error result, shows a rate limit that stopped the run, and keeps a line it cannot read", ({
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
    const [tools, raw, unknown, limit] = out.entries;
    expect(tools?.kind === "tools" && tools.tools[0]).toMatchObject({
      name: "mcp__lore__quest_get",
      detail: "shortId: 12",
      state: "failed",
      result: "Quest not found",
    });
    expect(raw).toEqual({ kind: "raw", line: "panic: something odd" });
    expect(unknown).toMatchObject({ kind: "raw" });
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

    // Ended, a line that is not JSON is still kept.
    const ended = AgentTranscript.parse(
      `${use}\n${result.slice(0, 5000)}\n`,
      "claude",
    );
    expect(ended.entries.map((it) => it.kind)).toEqual(["tools", "raw"]);
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
