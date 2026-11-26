import { AlephaError, z } from "alepha";
import {
  $tool,
  AlephaMcp,
  MCP_TASKS_EXTENSION,
  type McpContext,
  McpServerProvider,
  McpTaskStore,
  StreamableHttpMcpTransport,
  MODERN_PROTOCOL_VERSIONS,
  LEGACY_PROTOCOL_VERSIONS,
} from "alepha/mcp";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { JobMcpTaskStore } from "../index.ts";
import { jobStepsDialects } from "./jobStepsDialects.ts";

/**
 * The MCP Tasks extension on the wire (#Q3056), through the `$job`-backed
 * store: `tools/call` answered with a `CreateTaskResult`, then `tasks/get`,
 * `tasks/update` and `tasks/cancel`, authorized to the creating client key.
 */

const MODERN = "2026-07-28";

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 5000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new AlephaError(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

class Tools {
  report = $tool({
    description: "A long report, answered as a task",
    task: { ttlMs: 600_000 },
    schema: {
      params: z.object({ month: z.text() }),
      result: z.object({ rows: z.number() }),
    },
    handler: async ({ params }) => ({ rows: params.month.length }),
  });

  confirm = $tool({
    description: "Asks before doing it",
    task: true,
    handler: async ({ context }) => {
      const answer = await context!.elicit!({
        message: "Really?",
        schema: z.object({ ok: z.boolean() }),
      });
      return answer.action === "accept" && (answer as any).content.ok
        ? "done"
        : "skipped";
    },
  });

  broken = $tool({
    description: "Fails as a task",
    task: true,
    handler: async () => {
      throw new AlephaError("kaput");
    },
  });
}

const meta = (
  extensions: Record<string, unknown> = { [MCP_TASKS_EXTENSION]: {} },
) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {
    extensions,
    elicitation: { form: {} },
  },
});

describe.each(jobStepsDialects)("MCP tasks on $name", (dialect) => {
  const boot = async (bindStore = true) => {
    let alepha = dialect.create().with(AlephaMcp).with(Tools);
    if (bindStore) {
      alepha = alepha.with({ provide: McpTaskStore, use: JobMcpTaskStore });
    }
    await dialect.start(alepha);
    const mcp = alepha.inject(McpServerProvider);
    mcp.protocolVersions = [
      ...MODERN_PROTOCOL_VERSIONS,
      ...LEGACY_PROTOCOL_VERSIONS,
    ];
    let id = 1;
    const send = async (
      method: string,
      params: Record<string, unknown>,
      context: McpContext = { clientKey: "client-a" },
      withMeta: Record<string, unknown> | false = meta(),
    ) =>
      (await mcp.handleMessage(
        {
          jsonrpc: "2.0",
          id: id++,
          method,
          params: withMeta ? { ...params, _meta: withMeta } : params,
        },
        context,
      )) as any;
    return { alepha, mcp, send };
  };

  it("answers a task with a CreateTaskResult, then its result on tasks/get", async ({
    expect,
  }) => {
    const { alepha, mcp, send } = await boot();
    expect(mcp.hasExtension(MCP_TASKS_EXTENSION)).toBe(true);

    const created = await send("tools/call", {
      name: "report",
      arguments: { month: "march" },
    });
    expect(created.result).toMatchObject({
      resultType: "task",
      status: "working",
      ttlMs: 600_000,
      pollIntervalMs: 1_000,
    });
    const taskId = created.result.taskId;
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.result.createdAt).toBeTypeOf("string");
    expect(created.result.lastUpdatedAt).toBeTypeOf("string");

    const done = await waitFor(
      () => send("tasks/get", { taskId }),
      (r) => r.result?.status === "completed",
      { label: "completed" },
    );
    expect(done.result).toMatchObject({
      resultType: "complete",
      taskId,
      result: {
        content: [{ type: "text", text: '{"rows":5}' }],
        structuredContent: { rows: 5 },
      },
    });
    await alepha.stop();
  });

  it("moves an eliciting task to input_required, and takes its answer through tasks/update", async ({
    expect,
  }) => {
    const { alepha, send } = await boot();

    const { result } = await send("tools/call", {
      name: "confirm",
      arguments: {},
    });
    const taskId = result.taskId;

    const waiting = await waitFor(
      () => send("tasks/get", { taskId }),
      (r) => r.result?.status === "input_required",
      { label: "input_required" },
    );
    expect(waiting.result.inputRequests).toEqual({
      e0: {
        method: "elicitation/create",
        params: expect.objectContaining({ message: "Really?" }),
      },
    });

    const updated = await send("tasks/update", {
      taskId,
      inputResponses: { e0: { action: "accept", content: { ok: true } } },
    });
    expect(updated.result).toEqual(
      expect.objectContaining({ resultType: "complete" }),
    );

    const done = await waitFor(
      () => send("tasks/get", { taskId }),
      (r) => r.result?.status === "completed",
      { label: "completed" },
    );
    expect(done.result.result.content).toEqual([
      { type: "text", text: "done" },
    ]);

    const refused = await send("tasks/update", {
      taskId,
      inputResponses: { e0: { action: "accept", content: { ok: true } } },
    });
    expect(refused.error.code).toBe(-32602);
    await alepha.stop();
  });

  it("reports a failed task, and cancels a waiting one", async ({ expect }) => {
    const { alepha, send } = await boot();

    const broken = (await send("tools/call", { name: "broken", arguments: {} }))
      .result.taskId;
    // A tool error is a result: the task completes with `isError`.
    const done = await waitFor(
      () => send("tasks/get", { taskId: broken }),
      (r) => r.result?.status === "completed",
      { label: "completed with isError" },
    );
    expect(done.result.result.isError).toBe(true);

    const waiting = (
      await send("tools/call", { name: "confirm", arguments: {} })
    ).result.taskId;
    await waitFor(
      () => send("tasks/get", { taskId: waiting }),
      (r) => r.result?.status === "input_required",
      { label: "waiting" },
    );
    expect((await send("tasks/cancel", { taskId: waiting })).result).toEqual(
      expect.objectContaining({ resultType: "complete" }),
    );
    expect((await send("tasks/get", { taskId: waiting })).result.status).toBe(
      "cancelled",
    );
    await alepha.stop();
  });

  it("answers -32602 to another client, and to an unknown task", async ({
    expect,
  }) => {
    const { alepha, send } = await boot();

    const taskId = (
      await send("tools/call", { name: "report", arguments: { month: "may" } })
    ).result.taskId;

    for (const method of ["tasks/get", "tasks/cancel"]) {
      const other = await send(method, { taskId }, { clientKey: "client-b" });
      expect(other.error).toMatchObject({ code: -32602 });
    }
    const unknown = await send("tasks/get", {
      taskId: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.error).toMatchObject({
      code: -32602,
      message: "Failed to retrieve task: Task not found",
    });
    await alepha.stop();
  });

  it("answers plainly a legacy client, one without the extension, and one without a client key", async ({
    expect,
  }) => {
    const { alepha, send } = await boot();
    const call = { name: "report", arguments: { month: "june" } };

    const legacy = await send(
      "tools/call",
      call,
      { clientKey: "client-a" },
      false,
    );
    const undeclared = await send(
      "tools/call",
      call,
      { clientKey: "client-a" },
      meta({}),
    );
    const anonymous = await send("tools/call", call, {});

    for (const response of [legacy, undeclared, anonymous]) {
      expect(response.result.structuredContent).toEqual({ rows: 4 });
      expect(response.result.resultType).not.toBe("task");
    }
    await alepha.stop();
  });

  it("declares nothing and answers plainly with no store bound", async ({
    expect,
  }) => {
    const { alepha, mcp, send } = await boot(false);

    expect(mcp.hasExtension(MCP_TASKS_EXTENSION)).toBe(false);
    const plain = await send("tools/call", {
      name: "report",
      arguments: { month: "july" },
    });
    expect(plain.result.structuredContent).toEqual({ rows: 4 });
    const get = await send("tasks/get", { taskId: "x" });
    expect(get.error.code).toBe(-32601);
    await alepha.stop();
  });

  it("routes tasks/* over HTTP with Mcp-Name mirroring the task id", async ({
    expect,
  }) => {
    const alepha = dialect
      .create()
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with({ provide: McpTaskStore, use: JobMcpTaskStore })
      .with(Tools);
    await dialect.start(alepha);
    alepha.inject(McpServerProvider).protocolVersions = [
      ...MODERN_PROTOCOL_VERSIONS,
      ...LEGACY_PROTOCOL_VERSIONS,
    ];
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;
    const post = async (
      method: string,
      params: Record<string, unknown>,
      name?: string,
    ) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MODERN,
          "mcp-method": method,
          "mcp-session-id": "http-client",
          ...(name ? { "mcp-name": name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: { ...params, _meta: meta() },
        }),
      });
      return { status: res.status, body: (await res.json()) as any };
    };

    const created = await post(
      "tools/call",
      { name: "report", arguments: { month: "april" } },
      "report",
    );
    const taskId = created.body.result.taskId;
    expect(created.body.result.resultType).toBe("task");

    const missing = await post("tasks/get", { taskId });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe(-32020);

    const ok = await post("tasks/get", { taskId }, taskId);
    expect(ok.status).toBe(200);
    expect(ok.body.result.taskId).toBe(taskId);
    await alepha.stop();
  });
});
