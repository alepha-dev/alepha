import { EventEmitter } from "node:events";

import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaMcp, MCP_PROTOCOL_VERSION } from "../index.ts";
import { $tool } from "../primitives/$tool.ts";
import { StdioMcpTransport } from "../transports/StdioMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A stand-in for `process` whose three streams are inspectable.
 *
 * The transport resolves the host process through a protected method, so a
 * subclass can point it here. Nothing about the real process is touched —
 * which matters, because the transport's whole job is to take stdout over.
 */
class FakeProcess {
  stdin = new EventEmitter() as any;
  stdoutChunks: string[] = [];
  stderrChunks: string[] = [];

  stdout = {
    write: (chunk: any) => {
      this.stdoutChunks.push(String(chunk));
      return true;
    },
  };

  stderr = {
    write: (chunk: any) => {
      this.stderrChunks.push(String(chunk));
      return true;
    },
  };

  constructor() {
    this.stdin.setEncoding = () => {};
    this.stdin.resume = () => {};
  }

  /**
   * Protocol messages the client would have read, one per line.
   */
  get messages(): any[] {
    return this.stdoutChunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

const fake = new FakeProcess();

class TestStdioTransport extends StdioMcpTransport {
  protected process(): any {
    return fake;
  }
}

class Tools {
  ping = $tool({
    description: "Ping",
    schema: { result: z.text() },
    handler: async () => "pong",
  });

  /**
   * Writes to stdout mid-call — the classic way to corrupt the stream.
   */
  chatty = $tool({
    description: "Logs while working",
    schema: { result: z.text() },
    handler: async () => {
      fake.stdout.write("a wild log appears\n");
      return "done";
    },
  });
}

const start = async () => {
  fake.stdoutChunks = [];
  fake.stderrChunks = [];
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaMcp)
    .with(TestStdioTransport)
    .with(Tools);
  await alepha.start();
  return alepha;
};

/**
 * Feed one message and let the microtask queue drain.
 */
const send = async (message: unknown) => {
  fake.stdin.emit("data", `${JSON.stringify(message)}\n`);
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe("StdioMcpTransport", () => {
  it("answers a request with one JSON line", async () => {
    const alepha = await start();

    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: MCP_PROTOCOL_VERSION },
    });
    await alepha.stop();
  });

  it("calls a tool", async () => {
    const alepha = await start();

    await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    });

    expect(fake.messages[0].result.content[0].text).toBe("pong");
    await alepha.stop();
  });

  it("writes nothing at all for a notification", async () => {
    const alepha = await start();

    await send({ jsonrpc: "2.0", method: "notifications/initialized" });

    // Not an empty line, not an ack — the client is not reading for one.
    expect(fake.stdoutChunks).toEqual([]);
    await alepha.stop();
  });

  it("handles several messages arriving in one chunk", async () => {
    const alepha = await start();

    fake.stdin.emit(
      "data",
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n${JSON.stringify(
        { jsonrpc: "2.0", id: 2, method: "ping" },
      )}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fake.messages.map((m) => m.id)).toEqual([1, 2]);
    await alepha.stop();
  });

  it("reassembles a message split across chunks", async () => {
    const alepha = await start();

    const line = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" });
    fake.stdin.emit("data", line.slice(0, 12));
    fake.stdin.emit("data", `${line.slice(12)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fake.messages.map((m) => m.id)).toEqual([9]);
    await alepha.stop();
  });

  it("answers an unparseable line with a parse error and a null id", async () => {
    const alepha = await start();

    fake.stdin.emit("data", "{not json}\n");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fake.messages[0]).toMatchObject({
      id: null,
      error: { code: -32700 },
    });
    await alepha.stop();
  });

  it("ignores blank lines", async () => {
    const alepha = await start();

    fake.stdin.emit("data", "\n  \n");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fake.stdoutChunks).toEqual([]);
    await alepha.stop();
  });

  /**
   * The classic failure: one stray write lands in the middle of a JSON-RPC
   * message and corrupts the stream permanently. While the transport runs,
   * stdout belongs to the protocol and everything else goes to stderr.
   */
  it("keeps a tool's stdout writes out of the protocol stream", async () => {
    const alepha = await start();

    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "chatty", arguments: {} },
    });

    // Every stdout line still parses as JSON — nothing was interleaved.
    expect(() => fake.messages).not.toThrow();
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0].result.content[0].text).toBe("done");
    // ...and the write was not lost, just rerouted.
    expect(fake.stderrChunks.join("")).toContain("a wild log appears");
    await alepha.stop();
  });

  it("gives stdout back on stop", async () => {
    const alepha = await start();
    await alepha.stop();

    fake.stdoutChunks = [];
    fake.stdout.write("after stop\n");

    expect(fake.stdoutChunks).toEqual(["after stop\n"]);
    expect(fake.stderrChunks.join("")).not.toContain("after stop");
  });
});
