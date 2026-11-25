import { describe, it } from "vitest";

import { AgentTranscript } from "../src/api/schemas/AgentTranscript.ts";

/**
 * A long run's log, of a real run's shape: a tool call, its result, a line
 * of text, over and over, to `bytes`.
 */
const longLog = (bytes: number): string => {
  const lines: string[] = [
    JSON.stringify({ type: "system", subtype: "init", model: "m-1" }),
  ];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    for (const line of [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: `t${i}`,
              name: "Bash",
              input: { command: `yarn test --filter part-${i}` },
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
              tool_use_id: `t${i}`,
              content: "ok ".repeat(200),
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: `Step ${i} is green.` }] },
      }),
    ]) {
      lines.push(line);
      size += line.length + 1;
    }
  }
  return lines.join("\n");
};

/**
 * The job page parses a job's whole log in the browser (#Q4286): a 1 MB log
 * must not freeze the tab (#Q4293). Measured, and bounded far above the
 * measure so a slow runner does not flake.
 */
describe("AgentTranscript on a long log", () => {
  it("parses 1 MB of stream-json in a few tens of milliseconds", ({
    expect,
  }) => {
    const log = longLog(1_000_000);
    const started = performance.now();
    const out = AgentTranscript.parse(log, "claude");
    const took = performance.now() - started;
    console.info(
      `1 MB job log (${out.entries.length} entries) parsed in ${Math.round(took)} ms`,
    );
    expect(out.entries.length).toBeGreaterThan(1_000);
    expect(took).toBeLessThan(1_000);
  });
});
