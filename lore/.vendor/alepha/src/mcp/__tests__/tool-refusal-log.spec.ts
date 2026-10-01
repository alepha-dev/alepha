import { Alepha } from "alepha";
import { MemoryDestinationProvider } from "alepha/logger";
import { describe, it } from "vitest";

import { $tool, AlephaMcp, McpServerProvider } from "../index.ts";

class Refusal extends Error {
  public readonly name = "Refusal";
  public readonly status = 409;
}

class Tools {
  refuses = $tool({
    description: "Refuses a stale write",
    handler: async () => {
      throw new Refusal("Quest changed since you read it");
    },
  });

  crashes = $tool({
    description: "Breaks",
    handler: async () => {
      throw new Error("connection reset");
    },
  });

  unavailable = $tool({
    description: "Fails upstream",
    handler: async () => {
      throw Object.assign(new Error("upstream down"), { status: 503 });
    },
  });
}

/**
 * A tool that refuses a call is the API working: the agent reads the message
 * and corrects itself. Logging each refusal at error level buried the tool
 * failures that are real in the same stream, so a status below 500 logs at
 * warn and everything else stays an error.
 */
describe("MCP tool errors log at a level set by their status", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(Tools);
    await alepha.start();
    const logs = alepha.inject(MemoryDestinationProvider);
    const call = (name: string) =>
      alepha.inject(McpServerProvider).handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {} },
      });
    return { logs, call };
  };

  it("logs a 4xx refusal at warn, never at error", async ({ expect }) => {
    const { logs, call } = await boot();

    const response = await call("refuses");

    // The agent still gets the message it self-corrects from.
    expect(response?.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: "Error: Quest changed since you read it" },
      ],
    });
    expect(logs.wasLogged('MCP tool "refuses" refused the call', "WARN")).toBe(
      true,
    );
    expect(logs.wasLogged('MCP tool "refuses"', "ERROR")).toBe(false);

    const entry = logs.logs.find((it) => it.message.includes('"refuses"'));
    expect(entry?.data).toMatchObject({
      status: 409,
      error: "Refusal",
      message: "Quest changed since you read it",
    });
  });

  it("logs a crash with no status at error", async ({ expect }) => {
    const { logs, call } = await boot();

    await call("crashes");

    expect(logs.wasLogged('MCP tool "crashes" failed', "ERROR")).toBe(true);
    expect(logs.wasLogged('MCP tool "crashes"', "WARN")).toBe(false);
  });

  it("logs a 5xx at error", async ({ expect }) => {
    const { logs, call } = await boot();

    await call("unavailable");

    expect(logs.wasLogged('MCP tool "unavailable" failed', "ERROR")).toBe(true);
  });
});
