import { $inject, Alepha, TimeoutError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  $tool,
  AlephaMcp,
  McpServerProvider,
  mcpToolOptions,
} from "../index.ts";

class Tools {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);

  started?: () => void;
  aborted?: unknown;

  slow = $tool({
    description: "Takes an hour",
    timeout: [30, "seconds"],
    handler: async () => {
      const signal = this.alepha.context.signal;
      signal.addEventListener("abort", () => {
        this.aborted = signal.reason;
      });
      this.started?.();
      await this.dateTime.wait([1, "hours"]);
      return "done";
    },
  });

  defaulted = $tool({
    description: "Takes an hour, no timeout of its own",
    handler: async () => {
      this.started?.();
      await this.dateTime.wait([1, "hours"]);
      return "done";
    },
  });

  optedOut = $tool({
    description: "Takes ten seconds, opted out",
    timeout: false,
    handler: async () => {
      this.started?.();
      await this.dateTime.wait([10, "seconds"]);
      return "done";
    },
  });
}

const start = async (timeout?: number) => {
  const alepha = Alepha.create().with(AlephaMcp).with(Tools);
  if (timeout !== undefined) {
    alepha.store.mut(mcpToolOptions, () => ({ timeout }));
  }
  await alepha.start();
  const tools = alepha.inject(Tools);
  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  const provider = alepha.inject(McpServerProvider);
  const callPast = async (name: string, travel: number) => {
    const started = new Promise<void>((resolve) => {
      tools.started = resolve;
    });
    const pending = provider.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    await started;
    await dateTime.travel(travel);
    const response = await pending;
    return response?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
  };
  return { tools, callPast };
};

describe("$tool timeout", () => {
  it("returns a Tool Execution Error, not a JSON-RPC error, and aborts the call's signal", async ({
    expect,
  }) => {
    const { tools, callPast } = await start();

    const result = await callPast("slow", 30_000);

    expect(result).toEqual({
      content: [{ type: "text", text: "Error: Timed out after 30 s" }],
      isError: true,
    });
    expect(tools.aborted).toBeInstanceOf(TimeoutError);
  });

  it("applies the mcpToolOptions default to a tool without its own", async ({
    expect,
  }) => {
    const { callPast } = await start(2_000);

    const result = await callPast("defaulted", 2_000);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Timed out after 2 s");
  });

  it("has no default, and timeout: false opts out of one", async ({
    expect,
  }) => {
    const bare = Alepha.create().with(AlephaMcp).with(Tools);
    await bare.start();
    expect(
      bare.inject(McpServerProvider).getTool("defaulted")?.timeout,
    ).toBeUndefined();

    const { callPast } = await start(2_000);

    const result = await callPast("optedOut", 10_000);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("done");
  });
});
