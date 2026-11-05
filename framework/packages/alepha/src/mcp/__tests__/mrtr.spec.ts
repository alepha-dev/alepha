import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import {
  $prompt,
  $resource,
  $tool,
  AlephaMcp,
  MCP_LEGACY_PROTOCOL_VERSION,
  McpServerProvider,
} from "../index.ts";

/**
 * MRTR elicitation (SEP-2322, spec 2026-07-28): a handler asks with
 * `context.elicit`, the server answers `input_required` with a sealed
 * `requestState`, and the client retries the same call with the answers.
 */

const MODERN = "2026-07-28";

const meta = (capabilities: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "client", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": capabilities,
});

const FORM = { elicitation: { form: {} } };

const confirmSchema = z.object({ confirm: z.boolean() });
const pickSchema = z.object({
  env: z.enum(["staging", "production"]),
  reason: z.text().optional(),
});

let effects: string[] = [];

class Tools {
  rollback = $tool({
    description: "Roll back a deploy, after confirmation",
    schema: { params: z.object({ app: z.text() }), result: z.text() },
    handler: async ({ params, context }) => {
      const answer = await context!.elicit!({
        message: `Roll back ${params.app}?`,
        schema: confirmSchema,
      });
      if (answer.action === "unavailable") return "not asked";
      if (answer.action !== "accept" || !answer.content.confirm) {
        return "kept";
      }
      effects.push(`rollback:${params.app}`);
      return "rolled back";
    },
  });

  twoStep = $tool({
    description: "Two questions in a row",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      const first = await context!.elicit!({
        message: "Where?",
        schema: pickSchema,
      });
      const second = await context!.elicit!({
        message: "Sure?",
        schema: confirmSchema,
      });
      const env = first.action === "accept" ? first.content.env : "-";
      const sure = second.action === "accept" ? second.content.confirm : "-";
      return `${env}/${sure}`;
    },
  });

  strict = $tool({
    description: "Requires a form",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      await context!.elicit!({
        message: "Required",
        schema: confirmSchema,
        required: true,
      });
      return "asked";
    },
  });

  signIn = $tool({
    description: "Sends the user to a URL",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      const answer = await context!.elicit!({
        message: "Sign in",
        url: "https://idp.example/authorize",
      });
      return answer.action;
    },
  });

  nested = $tool({
    description: "Asks with a schema no client must render",
    schema: { result: z.text() },
    handler: async ({ context }) => {
      await context!.elicit!({
        message: "Nested",
        schema: z.object({ address: z.object({ city: z.text() }) }),
      });
      return "unreachable";
    },
  });

  secret = $resource({
    uri: "vault://secret",
    handler: async ({ context }) => {
      const answer = await context!.elicit!({
        message: "Reveal?",
        schema: confirmSchema,
      });
      return {
        text:
          answer.action === "accept" && answer.content.confirm ? "s3cr3t" : "",
      };
    },
  });

  greet = $prompt({
    description: "Asks who to greet",
    handler: async ({ context }) => {
      const answer = await context!.elicit!({
        message: "Who?",
        schema: z.object({ who: z.text() }),
      });
      return [
        {
          role: "user",
          content: `Hi ${answer.action === "accept" ? answer.content.who : "you"}`,
        },
      ];
    },
  });
}

const setup = async () => {
  effects = [];
  const alepha = Alepha.create().with(AlephaMcp).with(Tools);
  await alepha.start();
  return { alepha, mcp: alepha.inject(McpServerProvider) };
};

let nextId = 1;

const send = async (
  mcp: McpServerProvider,
  method: string,
  params: Record<string, unknown>,
  data?: unknown,
) =>
  (await mcp.handleMessage(
    { jsonrpc: "2.0", id: nextId++, method, params },
    { data },
  )) as { result?: any; error?: { code: number; message: string; data?: any } };

const callTool = (
  mcp: McpServerProvider,
  name: string,
  extra: Record<string, unknown> = {},
  capabilities: Record<string, unknown> = FORM,
  data?: unknown,
) =>
  send(
    mcp,
    "tools/call",
    { name, arguments: { app: "lore" }, _meta: meta(capabilities), ...extra },
    data,
  );

describe("MRTR: the input request", () => {
  it("answers an unanswered elicit with input_required, a form request and a sealed state", async () => {
    const { alepha, mcp } = await setup();

    const res = await callTool(mcp, "rollback");

    expect(res.error).toBeUndefined();
    expect(res.result.resultType).toBe("input_required");
    expect(res.result.inputRequests).toEqual({
      e0: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message: "Roll back lore?",
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        },
      },
    });
    expect(typeof res.result.requestState).toBe("string");
    // Sealed: the state reveals nothing it carries.
    expect(res.result.requestState).not.toContain("rollback");
    expect(res.result).not.toHaveProperty("ttlMs");
    expect(effects).toEqual([]);
    await alepha.stop();
  });

  it("runs the handler again from the top with the answer, side effects once", async () => {
    const { alepha, mcp } = await setup();

    const first = await callTool(mcp, "rollback");
    const retry = await callTool(mcp, "rollback", {
      inputResponses: { e0: { action: "accept", content: { confirm: true } } },
      requestState: first.result.requestState,
    });

    expect(retry.result.resultType).toBe("complete");
    expect(retry.result.content[0].text).toBe("rolled back");
    expect(effects).toEqual(["rollback:lore"]);
    await alepha.stop();
  });

  it("resolves decline and cancel", async () => {
    const { alepha, mcp } = await setup();

    for (const action of ["decline", "cancel"]) {
      const first = await callTool(mcp, "rollback");
      const retry = await callTool(mcp, "rollback", {
        inputResponses: { e0: { action } },
        requestState: first.result.requestState,
      });
      expect(retry.result.content[0].text).toBe("kept");
    }
    expect(effects).toEqual([]);
    await alepha.stop();
  });

  it("carries a multi-step dialogue: answers keyed by call order, sealed between rounds", async () => {
    const { alepha, mcp } = await setup();

    const r1 = await callTool(mcp, "twoStep");
    expect(Object.keys(r1.result.inputRequests)).toEqual(["e0"]);

    const r2 = await callTool(mcp, "twoStep", {
      inputResponses: {
        e0: { action: "accept", content: { env: "staging" } },
      },
      requestState: r1.result.requestState,
    });
    expect(r2.result.resultType).toBe("input_required");
    expect(Object.keys(r2.result.inputRequests)).toEqual(["e1"]);

    // The second retry carries only the new answer: the first rides in the
    // sealed state.
    const r3 = await callTool(mcp, "twoStep", {
      inputResponses: { e1: { action: "accept", content: { confirm: true } } },
      requestState: r2.result.requestState,
    });
    expect(r3.result.content[0].text).toBe("staging/true");
    await alepha.stop();
  });

  it("re-asks when the answer is missing or the content is invalid, and ignores unknown keys", async () => {
    const { alepha, mcp } = await setup();
    const first = await callTool(mcp, "rollback");

    const missing = await callTool(mcp, "rollback", {
      inputResponses: { e7: { action: "accept", content: { confirm: true } } },
      requestState: first.result.requestState,
    });
    expect(missing.result.resultType).toBe("input_required");
    expect(Object.keys(missing.result.inputRequests)).toEqual(["e0"]);

    const invalid = await callTool(mcp, "rollback", {
      inputResponses: { e0: { action: "accept", content: { confirm: "yes" } } },
      requestState: first.result.requestState,
    });
    expect(invalid.result.resultType).toBe("input_required");
    expect(effects).toEqual([]);
    await alepha.stop();
  });

  it("sends a URL request, and resolves accept without content", async () => {
    const { alepha, mcp } = await setup();
    const caps = { elicitation: { url: {} } };

    const first = await callTool(mcp, "signIn", {}, caps);
    const request = first.result.inputRequests.e0;
    expect(request.params.mode).toBe("url");
    expect(request.params.url).toBe("https://idp.example/authorize");
    expect(typeof request.params.elicitationId).toBe("string");

    const retry = await callTool(
      mcp,
      "signIn",
      {
        inputResponses: { e0: { action: "accept" } },
        requestState: first.result.requestState,
      },
      caps,
    );
    expect(retry.result.content[0].text).toBe("accept");
    await alepha.stop();
  });

  it("works on resources/read and prompts/get, and never caches a retry", async () => {
    const { alepha, mcp } = await setup();

    const read = await send(mcp, "resources/read", {
      uri: "vault://secret",
      _meta: meta(FORM),
    });
    expect(read.result.resultType).toBe("input_required");
    const readRetry = await send(mcp, "resources/read", {
      uri: "vault://secret",
      _meta: meta(FORM),
      inputResponses: { e0: { action: "accept", content: { confirm: true } } },
      requestState: read.result.requestState,
    });
    expect(readRetry.result.contents[0].text).toBe("s3cr3t");
    expect(readRetry.result.ttlMs).toBe(0);
    expect(readRetry.result.cacheScope).toBe("private");

    const prompt = await send(mcp, "prompts/get", {
      name: "greet",
      _meta: meta(FORM),
    });
    const promptRetry = await send(mcp, "prompts/get", {
      name: "greet",
      _meta: meta(FORM),
      inputResponses: { e0: { action: "accept", content: { who: "Ada" } } },
      requestState: prompt.result.requestState,
    });
    expect(promptRetry.result.messages[0].content.text).toBe("Hi Ada");
    await alepha.stop();
  });
});

describe("MRTR: the sealed state", () => {
  it("refuses a tampered state with -32602, never a fresh run", async () => {
    const { alepha, mcp } = await setup();
    const first = await callTool(mcp, "rollback");
    const state = first.result.requestState as string;
    const tampered = `${state.slice(0, -4)}${state.endsWith("0000") ? "1111" : "0000"}`;

    const res = await callTool(mcp, "rollback", {
      inputResponses: { e0: { action: "accept", content: { confirm: true } } },
      requestState: tampered,
    });

    expect(res.error?.code).toBe(-32602);
    expect(effects).toEqual([]);
    await alepha.stop();
  });

  it("refuses a state replayed with other params, another method or another caller", async () => {
    const { alepha, mcp } = await setup();
    const first = await callTool(mcp, "rollback", {}, FORM, { id: "u1" });
    const answer = { e0: { action: "accept", content: { confirm: true } } };
    const requestState = first.result.requestState;

    const otherParams = await send(
      mcp,
      "tools/call",
      {
        name: "rollback",
        arguments: { app: "bay" },
        _meta: meta(FORM),
        inputResponses: answer,
        requestState,
      },
      { id: "u1" },
    );
    expect(otherParams.error?.code).toBe(-32602);

    const otherMethod = await send(
      mcp,
      "resources/read",
      {
        uri: "vault://secret",
        _meta: meta(FORM),
        inputResponses: answer,
        requestState,
      },
      { id: "u1" },
    );
    expect(otherMethod.error?.code).toBe(-32602);

    const otherUser = await callTool(
      mcp,
      "rollback",
      { inputResponses: answer, requestState },
      FORM,
      { id: "u2" },
    );
    expect(otherUser.error?.code).toBe(-32602);

    const sameUser = await callTool(
      mcp,
      "rollback",
      { inputResponses: answer, requestState },
      FORM,
      { id: "u1" },
    );
    expect(sameUser.result.content[0].text).toBe("rolled back");
    await alepha.stop();
  });

  it("refuses an expired state", async () => {
    const { alepha, mcp } = await setup();
    const first = await callTool(mcp, "rollback");

    await alepha.inject(DateTimeProvider).travel(11, "minutes");
    const res = await callTool(mcp, "rollback", {
      inputResponses: { e0: { action: "accept", content: { confirm: true } } },
      requestState: first.result.requestState,
    });

    expect(res.error?.code).toBe(-32602);
    await alepha.stop();
  });
});

describe("MRTR: clients that cannot be asked", () => {
  it("resolves unavailable for a modern client that did not declare the mode", async () => {
    const { alepha, mcp } = await setup();

    const res = await callTool(mcp, "rollback", {}, {});

    expect(res.result.resultType).toBe("complete");
    expect(res.result.content[0].text).toBe("not asked");
    await alepha.stop();
  });

  it("reads an elicitation object naming no mode as form only", async () => {
    const { alepha, mcp } = await setup();

    const form = await callTool(mcp, "rollback", {}, { elicitation: {} });
    const url = await callTool(mcp, "signIn", {}, { elicitation: {} });

    expect(form.result.resultType).toBe("input_required");
    expect(url.result.content[0].text).toBe("unavailable");
    await alepha.stop();
  });

  it("resolves unavailable for a legacy client", async () => {
    const { alepha, mcp } = await setup();

    const res = await send(mcp, "tools/call", {
      name: "rollback",
      arguments: { app: "lore" },
    });

    expect(res.result.content[0].text).toBe("not asked");
    expect(res.result).not.toHaveProperty("resultType");
    await alepha.stop();
  });

  it("turns required: true into -32021 with requiredCapabilities for a modern client", async () => {
    const { alepha, mcp } = await setup();

    const res = await callTool(mcp, "strict", {}, {});

    expect(res.error?.code).toBe(-32021);
    expect(res.error?.data).toEqual({
      requiredCapabilities: { elicitation: { form: {} } },
    });
    await alepha.stop();
  });

  it("turns required: true into a -31003 refusal naming the capability for a legacy client", async () => {
    const { alepha, mcp } = await setup();

    const res = await send(mcp, "tools/call", {
      name: "strict",
      arguments: {},
    });

    expect(res.error?.code).toBe(-31003);
    expect(res.error?.message).toContain("form elicitation");
    await alepha.stop();
  });
});

describe("MRTR: schemas and scope", () => {
  it("refuses a schema a client is not required to render", async () => {
    const { alepha, mcp } = await setup();

    const res = await callTool(mcp, "nested");

    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("address");
    await alepha.stop();
  });

  it("never answers input_required on a method that cannot elicit", async () => {
    const { alepha, mcp } = await setup();

    const res = await send(mcp, "tools/list", { _meta: meta(FORM) });

    expect(res.result.resultType).toBe("complete");
    await alepha.stop();
  });

  it("initialize stays untouched", async () => {
    const { alepha, mcp } = await setup();

    const res = await send(mcp, "initialize", {
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "c", version: "1" },
    });

    expect(res.result.serverInfo.name).toBe("alepha-mcp");
    await alepha.stop();
  });
});

describe("MRTR over HTTP", () => {
  it("sends -32021 with HTTP 400", async () => {
    const { ServerProvider } = await import("alepha/server");
    const { StreamableHttpMcpTransport } =
      await import("../transports/StreamableHttpMcpTransport.ts");
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaMcp)
      .with(StreamableHttpMcpTransport)
      .with(Tools);
    await alepha.start();

    const res = await fetch(`${alepha.inject(ServerProvider).hostname}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": MODERN,
        "mcp-method": "tools/call",
        "mcp-name": "strict",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "strict", arguments: {}, _meta: meta({}) },
      }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32021);
    await alepha.stop();
  });
});
