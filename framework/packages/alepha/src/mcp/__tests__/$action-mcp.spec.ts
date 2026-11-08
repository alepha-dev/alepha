import { $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { MemoryDestinationProvider } from "alepha/logger";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { $action, NotFoundError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  mcpToolOptions,
  McpServerProvider,
  MODERN_PROTOCOL_VERSIONS,
} from "../index.ts";
import { StreamableHttpMcpTransport } from "../transports/StreamableHttpMcpTransport.ts";

/**
 * What the actions saw, for the assertions.
 */
class Probe {
  aborted?: unknown;
  started?: () => void;
  ready?: Promise<void>;
  ends: Array<{ name: string; outcome: string }> = [];

  protected readonly onEnd = $hook({
    on: "mcp:tool:call:end",
    handler: ({ name, outcome }) => {
      this.ends.push({ name, outcome });
    },
  });
}

class QuestApi {
  protected readonly alepha = $inject(Alepha);
  protected readonly probe = $inject(Probe);

  get = $action({
    method: "GET",
    path: "/quests/:id",
    description: "Read one quest",
    mcp: true,
    schema: {
      params: z.object({ id: z.integer() }),
      query: z.object({ detail: z.boolean().default(false) }),
      response: z.object({ id: z.integer(), detail: z.boolean() }),
    },
    handler: ({ params, query }) => ({ id: params.id, detail: query.detail }),
  });

  rename = $action({
    method: "PATCH",
    path: "/quests/:id",
    description: "Rename a quest",
    mcp: { name: "quest.rename", title: "Rename quest" },
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ title: z.text() }),
    },
    handler: ({ body }) => body.title,
  });

  remove = $action({
    method: "DELETE",
    path: "/quests/:id",
    description: "Delete a quest",
    mcp: { annotations: { destructiveHint: false, idempotentHint: true } },
    schema: { params: z.object({ id: z.integer() }) },
    handler: () => "deleted",
  });

  whoami = $action({
    method: "GET",
    path: "/whoami",
    description: "The caller's id",
    mcp: true,
    use: [$secure()],
    handler: ({ user }) => user.id,
  });

  missing = $action({
    method: "GET",
    path: "/missing",
    description: "Always 404",
    mcp: true,
    handler: () => {
      throw new NotFoundError("Quest not found");
    },
  });

  crash = $action({
    method: "GET",
    path: "/crash",
    description: "Breaks",
    mcp: true,
    handler: () => {
      throw new AlephaError("password=hunter2 in the driver error");
    },
  });

  slow = $action({
    method: "GET",
    path: "/slow",
    description: "Waits until aborted",
    mcp: true,
    timeout: [50, "milliseconds"],
    handler: async () => {
      const signal = this.alepha.context.signal;
      this.probe.started?.();
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      this.probe.aborted = signal.reason;
      return "late";
    },
  });

  patient = $action({
    method: "GET",
    path: "/patient",
    description: "Waits until cancelled",
    mcp: true,
    timeout: false,
    handler: async () => {
      const signal = this.alepha.context.signal;
      this.probe.started?.();
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      this.probe.aborted = signal.reason;
      return "late";
    },
  });

  hidden = $action({
    method: "GET",
    path: "/hidden",
    description: "Not served over MCP",
    handler: () => "hidden",
  });
}

const call = (
  mcp: McpServerProvider,
  name: string,
  args: Record<string, unknown> = {},
  id = 1,
  context?: Parameters<McpServerProvider["handleMessage"]>[1],
) =>
  mcp.handleMessage(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    context,
  );

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaSecurity)
    .with(AlephaMcp)
    .with(QuestApi);
  await alepha.start();
  return {
    alepha,
    mcp: alepha.inject(McpServerProvider),
    probe: alepha.inject(Probe),
    logs: alepha.inject(MemoryDestinationProvider),
  };
};

describe("$action({ mcp })", () => {
  it("lists the actions declaring mcp, with { params, query, body } and the method's hints", async ({
    expect,
  }) => {
    const { mcp } = await boot();

    const res = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const tools = (res!.result as { tools: any[] }).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        "crash",
        "get",
        "missing",
        "patient",
        "quest.rename",
        "remove",
        "slow",
        "whoami",
      ].sort(),
    );
    expect(byName.get).toEqual({
      name: "get",
      description: "Read one quest",
      annotations: { readOnlyHint: true },
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          params: {
            type: "object",
            properties: {
              id: {
                type: "integer",
                minimum: expect.any(Number),
                maximum: expect.any(Number),
              },
            },
            required: ["id"],
          },
          query: {
            type: "object",
            properties: { detail: { type: "boolean", default: false } },
          },
        },
        required: ["params"],
        additionalProperties: false,
      },
    });
    expect(byName["quest.rename"]).toMatchObject({ title: "Rename quest" });
    expect(byName["quest.rename"].annotations).toBeUndefined();
    expect(byName.remove.annotations).toEqual({
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("calls the action with the parts it declares", async ({ expect }) => {
    const { mcp, probe } = await boot();

    const read = await call(mcp, "get", { params: { id: 7 } });
    expect(read?.result).toEqual({
      content: [
        { type: "text", text: JSON.stringify({ id: 7, detail: false }) },
      ],
    });

    const renamed = await call(mcp, "quest.rename", {
      params: { id: 7 },
      body: { title: "New" },
    });
    expect(renamed?.result).toEqual({
      content: [{ type: "text", text: "New" }],
    });
    expect(probe.ends).toEqual([
      { name: "get", outcome: "ok" },
      { name: "quest.rename", outcome: "ok" },
    ]);
  });

  it("answers an HttpError as a tool error '<name>: <message>', and logs it below error", async ({
    expect,
  }) => {
    const { mcp, probe, logs } = await boot();

    const res = await call(mcp, "missing");

    expect(res?.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringMatching(/: Quest not found$/) },
      ],
    });
    expect(logs.wasLogged('MCP tool "missing" refused the call', "WARN")).toBe(
      true,
    );
    expect(logs.wasLogged('MCP tool "missing"', "ERROR")).toBe(false);
    expect(probe.ends).toEqual([{ name: "missing", outcome: "refused" }]);
  });

  it("answers a validation failure as a tool error", async ({ expect }) => {
    const { mcp } = await boot();

    const res = await call(mcp, "get", { params: { id: "seven" } });

    expect(res?.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringMatching(/^Validation error at/) },
      ],
    });
  });

  it("answers anything else as an internal error, its message not leaked", async ({
    expect,
  }) => {
    const { mcp, probe } = await boot();

    const res = await call(mcp, "crash");

    expect(res?.error).toEqual({ code: -32603, message: "Internal error" });
    expect(JSON.stringify(res)).not.toContain("hunter2");
    expect(probe.ends).toEqual([{ name: "crash", outcome: "error" }]);
  });

  it("runs anonymous over stdio: a $secure action refuses as a tool error", async ({
    expect,
  }) => {
    const { mcp, logs } = await boot();

    const res = await call(mcp, "whoami");

    expect(res?.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/Unauthorized/i) }],
    });
    expect(logs.wasLogged('MCP tool "whoami"', "ERROR")).toBe(false);
  });

  it("runs under the action's own timeout, not mcpToolOptions.timeout", async ({
    expect,
  }) => {
    const { alepha, mcp, probe } = await boot();
    alepha.store.set(mcpToolOptions, { timeout: 10 });

    const res = await call(mcp, "slow");

    expect(res?.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringMatching(/Timed out after 50 ms/) },
      ],
    });
    expect((probe.aborted as Error).name).toBe("TIMEOUT");
    expect(probe.ends).toEqual([{ name: "slow", outcome: "error" }]);
  });

  it("aborts the action's ambient signal when the MCP request is cancelled", async ({
    expect,
  }) => {
    const { mcp, probe } = await boot();
    probe.ready = new Promise((resolve) => {
      probe.started = resolve;
    });

    const pending = call(mcp, "patient", {}, 42, { clientKey: "alice" });
    await probe.ready;
    expect(mcp.cancelRequest(42, "alice")).toBe(true);

    expect(await pending).toBeNull();
    expect(probe.aborted).toBeDefined();
  });

  it("fails at start on a name clash with a $tool", async ({ expect }) => {
    class Tools {
      get = $tool({ description: "Clash", handler: () => "x" });
    }
    const alepha = Alepha.create().with(AlephaMcp).with(QuestApi).with(Tools);

    await expect(alepha.start()).rejects.toThrow(
      "MCP tool 'get' is registered twice",
    );
  });
});

describe("$action({ mcp }) over Streamable HTTP", () => {
  const http = async (versions: string[]) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaSecurity)
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(QuestApi);
    await alepha.start();
    alepha.inject(McpServerProvider).protocolVersions = versions;
    const url = `${alepha.inject(ServerProvider).hostname}/mcp`;
    const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
    const jwt = alepha.inject(JwtProvider);
    const token = await jwt.create({ sub: "u1", roles: [] }, realm, {
      header: { typ: jwt.accessTokenTyp },
    });
    const post = async (
      body: Record<string, unknown>,
      headers: Record<string, string> = {},
    ) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    };
    return { post, token };
  };

  it("legacy era: the action sees the bearer's user, and refuses without one", async ({
    expect,
  }) => {
    const { post, token } = await http([...LEGACY_PROTOCOL_VERSIONS]);
    const whoami = {
      id: 1,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    };

    const signedIn = await post(whoami, { authorization: `Bearer ${token}` });
    expect(signedIn.body.result).toEqual({
      content: [{ type: "text", text: "u1" }],
    });

    const anonymous = await post(whoami);
    expect(anonymous.body.result).toMatchObject({ isError: true });
  });

  it("modern era: lists and calls the action", async ({ expect }) => {
    const { post, token } = await http([
      ...MODERN_PROTOCOL_VERSIONS,
      ...LEGACY_PROTOCOL_VERSIONS,
    ]);
    const version = MODERN_PROTOCOL_VERSIONS[0];
    const meta = {
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientInfo": { name: "spec", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const headers = (method: string, name?: string) => ({
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": version,
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
    });

    const list = await post(
      { id: 1, method: "tools/list", params: { _meta: meta } },
      headers("tools/list"),
    );
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map((t: any) => t.name)).toContain("whoami");

    const res = await post(
      {
        id: 2,
        method: "tools/call",
        params: { name: "whoami", arguments: {}, _meta: meta },
      },
      headers("tools/call", "whoami"),
    );
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({
      content: [{ type: "text", text: "u1" }],
    });
  });
});
