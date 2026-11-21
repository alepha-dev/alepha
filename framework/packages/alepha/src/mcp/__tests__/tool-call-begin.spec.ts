import { $hook, Alepha } from "alepha";
import { ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import { $tool, AlephaMcp, McpServerProvider } from "../index.ts";

class Tools {
  public ran: string[] = [];

  allowed = $tool({
    description: "Runs",
    handler: async () => {
      this.ran.push("allowed");
      return { ok: true };
    },
  });

  gated = $tool({
    description: "Gated",
    handler: async () => {
      this.ran.push("gated");
      return { ok: true };
    },
  });
}

class Gate {
  public seen: Array<{ name: string; args: Record<string, unknown> }> = [];
  public outcomes: string[] = [];

  begin = $hook({
    on: "mcp:tool:call:begin",
    handler: ({ name, args }) => {
      this.seen.push({ name, args });
      if (name === "gated") {
        throw new ForbiddenError("This credential does not reach gated");
      }
    },
  });

  end = $hook({
    on: "mcp:tool:call:end",
    handler: ({ outcome }) => {
      this.outcomes.push(outcome);
    },
  });
}

/**
 * `mcp:tool:call:begin` is a gate: an application bounds a credential to its
 * tools server side, and a throw refuses the call before the tool runs.
 */
describe("mcp:tool:call:begin", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(Tools).with(Gate);
    await alepha.start();
    const call = (name: string, args: Record<string, unknown> = {}) =>
      alepha.inject(McpServerProvider).handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
    return { alepha, call };
  };

  it("sees the call's name and arguments before the tool runs", async ({
    expect,
  }) => {
    const { alepha, call } = await boot();
    const response = await call("allowed", { shortId: 12 });
    expect(response?.result).not.toMatchObject({ isError: true });
    expect(alepha.inject(Gate).seen).toEqual([
      { name: "allowed", args: { shortId: 12 } },
    ]);
    expect(alepha.inject(Tools).ran).toEqual(["allowed"]);
  });

  it("refuses the call when a subscriber throws, and the tool never runs", async ({
    expect,
  }) => {
    const { alepha, call } = await boot();
    const response = await call("gated");
    expect(response?.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: This credential does not reach gated",
        },
      ],
    });
    expect(alepha.inject(Tools).ran).toEqual([]);
    expect(alepha.inject(Gate).outcomes).toEqual(["refused"]);
  });
});
