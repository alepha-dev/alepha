import { Alepha, z } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  $ai,
  AI_TURN_SPENT,
  AI_TURN_WRAP_UP,
  type AiChatRequest,
  AiConfigError,
  type AiEvent,
  AiProvider,
  AlephaAi,
  type AiMessage,
  type AiTurnEvent,
  clientTool,
  MemoryAiProvider,
} from "../index.ts";

const member = { id: "u1", realm: "default", roles: ["member"] };

class InvoiceApi {
  public created: Array<{ by?: string; amount: number }> = [];

  list = $action({
    method: "GET",
    path: "/invoices",
    description: "List the invoices of the signed-in user",
    use: [$secure()],
    schema: {
      query: z.object({ status: z.enum(["open", "paid"]).optional() }),
      response: z.array(z.object({ id: z.integer(), status: z.text() })),
    },
    handler: ({ query, user }) =>
      [
        { id: 1, status: "open", owner: user.id },
        { id: 2, status: "paid", owner: user.id },
      ].filter((i) => !query.status || i.status === query.status),
  });

  create = $action({
    method: "POST",
    path: "/invoices",
    description: "Create an invoice",
    use: [$secure()],
    schema: {
      body: z.object({ amount: z.number() }),
      response: z.object({ id: z.integer() }),
    },
    handler: ({ body, user }) => {
      this.created.push({ by: user.id, amount: body.amount });
      return { id: 3 };
    },
  });

  purge = $action({
    method: "GET",
    path: "/invoices/purge-preview/:year",
    description: "Preview a purge of every invoice of a year (admin only)",
    use: [$secure({ roles: ["admin"] })],
    schema: {
      params: z.object({ year: z.integer() }),
      response: z.object({ count: z.integer() }),
    },
    handler: () => ({ count: 42 }),
  });
}

/**
 * A provider that never answers until its signal aborts: only a bound on the
 * loop can end a call to it.
 */
class HangingAiProvider extends MemoryAiProvider {
  public override async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const signal = this.signalOf(request);
    await new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    yield { type: "end", reason: "stop" };
  }
}

const setup = async (
  options: Partial<Parameters<typeof $ai>[0]> = {},
  hanging = false,
) => {
  const alepha = Alepha.create().with(AlephaSecurity);
  if (hanging) {
    alepha.with({ provide: AiProvider, use: HangingAiProvider });
  }
  alepha.with(AlephaAi);
  const api = alepha.inject(InvoiceApi);

  class Assistant {
    support = $ai({
      system: "You help with invoices.",
      tools: [
        api.list,
        api.create,
        api.purge,
        clientTool("navigate", {
          description: "Open a page of the app",
          schema: z.object({ page: z.text() }),
        }),
      ],
      ...options,
    });
  }

  const assistant = alepha.inject(Assistant);
  await alepha.start();
  return {
    alepha,
    api,
    ai: alepha.inject(AiProvider) as MemoryAiProvider,
    support: assistant.support,
  };
};

const collect = async (stream: AsyncIterable<AiTurnEvent>) => {
  const events: AiTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const ask = (content: string): AiMessage[] => [{ role: "user", content }];

describe("$ai", () => {
  it("turns each action into a tool: name, description, params/query/body input", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    await support.run({ messages: ask("hi"), user: member });

    const tools = ai.last!.tools!;
    expect(tools.map((t) => t.name)).toEqual([
      "list",
      "create",
      "purge",
      "navigate",
    ]);
    const list = tools[0];
    expect(list.description).toBe("List the invoices of the signed-in user");
    expect(list.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "object" } },
      required: [],
    });
    expect(Object.keys(tools[1].inputSchema.properties as object)).toEqual([
      "body",
    ]);
    expect(tools[2].inputSchema.required).toEqual(["params"]);
  });

  it("takes tools as a function, called once on first use and not at init", async ({
    expect,
  }) => {
    // The class holding the tools exists (the lock refuses a new one after
    // start); what the function defers is reading it.
    const alepha = Alepha.create()
      .with(AlephaSecurity)
      .with(AlephaAi)
      .with(InvoiceApi);
    let calls = 0;

    class LazyAssistant {
      support = $ai({
        system: "You help with invoices.",
        tools: () => {
          calls++;
          const api = alepha.inject(InvoiceApi);
          return [api.list, api.create];
        },
      });
    }

    const assistant = alepha.inject(LazyAssistant);
    await alepha.start();
    expect(calls).toBe(0);

    await assistant.support.run({ messages: ask("hi"), user: member });
    await assistant.support.run({ messages: ask("again"), user: member });
    const ai = alepha.inject(AiProvider) as MemoryAiProvider;
    expect(calls).toBe(1);
    expect(ai.last!.tools!.map((t) => t.name)).toEqual(["list", "create"]);
  });

  it("throws at start on a tool name a vendor would refuse, or a missing description", async ({
    expect,
  }) => {
    const build = (action: any) => {
      const alepha = Alepha.create().with(AlephaSecurity).with(AlephaAi);
      class Assistant {
        support = $ai({ system: "s", tools: [action] });
      }
      return () => alepha.inject(Assistant);
    };
    class Api {
      undescribed = $action({
        method: "GET",
        path: "/x",
        handler: () => "x",
      });
      dotted = $action({
        name: "invoices.list",
        method: "GET",
        path: "/y",
        description: "y",
        handler: () => "y",
      });
    }
    const api = Alepha.create().inject(Api);
    expect(build(api.undescribed)).toThrow(AiConfigError);
    expect(build(api.undescribed)).toThrow("has no description");
    expect(build(api.dotted)).toThrow("Invalid AI tool name");
  });

  it("appends a turn's instructions after the system prompt and runs it on the turn's model", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ model: "base-model" });
    ai.script([{ type: "text", text: "a" }]);
    ai.script([{ type: "text", text: "b" }]);

    const persona = await support.run({
      messages: ask("hi"),
      user: member,
      model: "persona-model",
      instructions: "You are Jarvis.",
    });
    expect(ai.requests[0]!.system).toBe(
      "You help with invoices.\n\nYou are Jarvis.",
    );
    expect(ai.requests[0]!.model).toBe("persona-model");
    expect(persona.messages[0]).toBeDefined();

    // Without them, the option's model and the bare prompt.
    await support.run({ messages: ask("hi"), user: member });
    expect(ai.requests[1]!.system).toBe("You help with invoices.");
    expect(ai.requests[1]!.model).toBe("base-model");
  });

  it("reports the turn's model on each assistant message", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ model: "base-model" });
    ai.script([{ type: "text", text: "a" }]);

    const events = await collect(
      support.stream({
        messages: ask("hi"),
        user: member,
        model: "persona-model",
      }),
    );
    const message = events.find(
      (it) => it.type === "message" && it.message.role === "assistant",
    );
    expect(message).toMatchObject({ model: "persona-model" });
  });

  it("runs a read as the user, feeds the result back, and answers", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "list",
        input: { query: { status: "open" } },
      },
      { type: "usage", inputTokens: 100, outputTokens: 10 },
    ]);
    ai.script([
      { type: "text", text: "One open invoice." },
      { type: "usage", inputTokens: 150, outputTokens: 5 },
    ]);

    const result = await support.run({
      messages: ask("open ones?"),
      user: member,
    });

    expect(result.reason).toBe("stop");
    expect(result.text).toBe("One open invoice.");
    expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 15 });
    expect(result.messages.map((m) => m.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.messages[1]).toEqual({
      role: "tool",
      callId: "c1",
      name: "list",
      content: JSON.stringify([{ id: 1, status: "open" }]),
    });
    // The second model call saw the result.
    expect(ai.last!.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "c1",
    });
  });

  it("returns a $secure refusal to the model as a tool error, never as a 403", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "purge",
        input: { params: { year: 2025 } },
      },
    ]);
    ai.script([{ type: "text", text: "You cannot do that." }]);

    const result = await support.run({
      messages: ask("purge 2025"),
      user: member,
    });

    const tool = result.messages[1] as any;
    expect(tool.isError).toBe(true);
    expect(tool.content).toMatch(/Forbidden/i);
    expect(result.reason).toBe("stop");
  });

  it("runs anonymous without a user, so a secured action refuses", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([{ type: "tool_call", id: "c1", name: "list", input: {} }]);
    ai.script([{ type: "text", text: "Sign in first." }]);

    const result = await support.run({ messages: ask("list") });

    expect((result.messages[1] as any).isError).toBe(true);
    expect((result.messages[1] as any).content).toMatch(/Unauthorized/i);
  });

  it("pauses a mutation for confirmation, then runs the STORED input on approve", async ({
    expect,
  }) => {
    const { support, ai, api } = await setup();
    ai.script([
      { type: "text", text: "Creating it." },
      {
        type: "tool_call",
        id: "c1",
        name: "create",
        input: { body: { amount: 120 } },
      },
    ]);

    const first = await collect(
      support.stream({ messages: ask("bill 120"), user: member }),
    );
    expect(first.at(-2)).toEqual({
      type: "confirm",
      callId: "c1",
      name: "create",
      input: { body: { amount: 120 } },
    });
    expect(first.at(-1)).toEqual({ type: "end", reason: "paused" });
    expect(api.created).toEqual([]);

    // What a server would have stored: the conversation up to the pause.
    const stored: AiMessage[] = [
      ...ask("bill 120"),
      ...first
        .filter((e) => e.type === "message")
        .map((e) => (e as { message: AiMessage }).message),
    ];
    expect(support.pendingOf(stored)).toEqual({
      callId: "c1",
      name: "create",
      input: { body: { amount: 120 } },
      kind: "confirm",
    });

    ai.script([{ type: "text", text: "Done, invoice 3." }]);
    const resumed = await support.run({
      messages: stored,
      user: member,
      resume: { callId: "c1", decision: "approve" },
    });

    expect(api.created).toEqual([{ by: "u1", amount: 120 }]);
    expect(resumed.messages[0]).toEqual({
      role: "tool",
      callId: "c1",
      name: "create",
      content: '{"id":3}',
    });
    expect(resumed.text).toBe("Done, invoice 3.");
  });

  it("turns a denial into a tool error and refuses a call id nothing waits on", async ({
    expect,
  }) => {
    const { support, ai, api } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "create",
        input: { body: { amount: 5 } },
      },
    ]);
    const paused = await support.run({ messages: ask("bill 5"), user: member });
    const stored = [...ask("bill 5"), ...paused.messages];

    await expect(
      support.run({
        messages: stored,
        user: member,
        resume: { callId: "forged", decision: "approve" },
      }),
    ).rejects.toThrow("nothing waits on call 'forged'");

    ai.script([{ type: "text", text: "Okay, not created." }]);
    const denied = await support.run({
      messages: stored,
      user: member,
      resume: { callId: "c1", decision: "deny" },
    });

    expect(denied.messages[0]).toMatchObject({
      role: "tool",
      callId: "c1",
      isError: true,
      content: "Denied by the user.",
    });
    expect(api.created).toEqual([]);
  });

  it("pauses on a client tool and resumes with its result", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "n1",
        name: "navigate",
        input: { page: "invoices" },
      },
    ]);
    const paused = await support.run({
      messages: ask("show invoices"),
      user: member,
    });
    expect(paused.reason).toBe("paused");
    expect(paused.pending).toEqual({
      callId: "n1",
      name: "navigate",
      input: { page: "invoices" },
      kind: "client_tool",
    });

    ai.script([{ type: "text", text: "Here they are." }]);
    const stored = [...ask("show invoices"), ...paused.messages];
    const resumed = await support.run({
      messages: stored,
      user: member,
      resume: { callId: "n1", result: { ok: true } },
    });
    expect(resumed.messages[0]).toEqual({
      role: "tool",
      callId: "n1",
      name: "navigate",
      content: '{"ok":true}',
    });
    await expect(
      support.run({
        messages: stored,
        user: member,
        resume: { callId: "n1", decision: "approve" },
      }),
    ).rejects.toThrow("takes a result, not a decision");
  });

  it("runs automatic calls before the one that pauses, in order", async ({
    expect,
  }) => {
    const { support, ai, api } = await setup();
    ai.script([
      { type: "tool_call", id: "a", name: "list", input: {} },
      {
        type: "tool_call",
        id: "b",
        name: "create",
        input: { body: { amount: 1 } },
      },
    ]);
    const paused = await support.run({ messages: ask("x"), user: member });
    expect(paused.messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(paused.pending?.callId).toBe("b");
    expect(api.created).toEqual([]);
  });

  it("puts page context on the user message, capped at 8 KB, the system prompt untouched", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    const big = "é".repeat(10_000);

    const result = await support.run({
      messages: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "what is this?" },
      ],
      user: member,
      context: { route: "/invoices/7", page: "invoice", data: { note: big } },
    });

    const sent = ai.last!;
    expect(sent.system).toBe("You help with invoices.");
    expect(sent.messages[0]).toEqual({ role: "user", content: "earlier" });
    const content = sent.messages[2].content as string;
    expect(content.startsWith("what is this?\n\n<page-context>\n")).toBe(true);
    expect(content).toContain('"route":"/invoices/7"');
    expect(content.endsWith("...[truncated]\n</page-context>")).toBe(true);
    const block = content.slice(
      content.indexOf("\n", content.indexOf("<page-context>")) + 1,
      content.lastIndexOf("\n</page-context>"),
    );
    expect(new TextEncoder().encode(block).length).toBeLessThanOrEqual(
      8 * 1024,
    );
    // The augmented message is emitted, so the server stores what was sent.
    expect(result.messages[0]).toEqual(sent.messages[2]);
  });

  it("stops at maxSteps with end length, the last call's own calls not run", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ maxSteps: 2 });
    for (let i = 0; i < 3; i++) {
      ai.script([{ type: "tool_call", id: `c${i}`, name: "list", input: {} }]);
    }
    const result = await support.run({ messages: ask("loop"), user: member });
    expect(result.reason).toBe("length");
    expect(ai.requests).toHaveLength(2);
    expect(result.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "c1",
      isError: true,
      content: AI_TURN_SPENT,
    });
  });

  it("asks for the answer before the last call maxSteps allows", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ maxSteps: 3 });
    ai.script([{ type: "tool_call", id: "c1", name: "list", input: {} }]);
    ai.script([
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "open" } },
      },
    ]);
    ai.script([{ type: "text", text: "Two lists." }]);

    const result = await support.run({ messages: ask("list"), user: member });

    expect(result.reason).toBe("stop");
    expect(result.text).toBe("Two lists.");
    // Not after the first round, which leaves two calls: after the second.
    const [first, second] = ai.requests[2].messages.filter(
      (it) => it.role === "tool",
    );
    expect(first.content).not.toContain(AI_TURN_WRAP_UP);
    expect(second.content).toContain(AI_TURN_WRAP_UP);
  });

  it("never runs the same call twice in a turn", async ({ expect }) => {
    const { support, ai } = await setup();
    ai.script([
      { type: "tool_call", id: "c1", name: "list", input: { query: {} } },
    ]);
    ai.script([
      { type: "tool_call", id: "c2", name: "list", input: { query: {} } },
    ]);
    ai.script([{ type: "text", text: "Two invoices." }]);
    const result = await support.run({ messages: ask("list"), user: member });
    const tools = result.messages.filter((m) => m.role === "tool");
    expect(tools[0].content).toContain('"status":"open"');
    expect(tools[1].content).toContain("call 'c1' earlier in this turn");
    expect(result.text).toBe("Two invoices.");
  });

  it("answers a call past maxCallsPerTool without running it", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ maxCallsPerTool: 1 });
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "list",
        input: { query: { status: "open" } },
      },
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "paid" } },
      },
    ]);
    ai.script([{ type: "text", text: "One open." }]);
    const result = await support.run({ messages: ask("list"), user: member });
    const tools = result.messages.filter((m) => m.role === "tool");
    expect(tools[1]).toMatchObject({ callId: "c2", isError: true });
    expect(tools[1].content).toContain("already called 1 times");
  });

  it("cuts a tool result at maxResultLength", async ({ expect }) => {
    const { support, ai } = await setup({ maxResultLength: 10 });
    ai.script([{ type: "tool_call", id: "c1", name: "list", input: {} }]);
    ai.script([{ type: "text", text: "ok" }]);
    const result = await support.run({ messages: ask("list"), user: member });
    const tool = result.messages.find((m) => m.role === "tool");
    expect(tool?.content).toMatch(/^.{10}\.\.\.\[truncated\]$/);
  });

  it("wraps up before turnTokens: the last results ask for the answer, and a call after it is not run", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ turnTokens: 1000 });
    // 400 spent, and the next call costs about as much: the one after it
    // would cross 1000, so the next call is the last.
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "list",
        input: { query: { status: "open" } },
      },
      { type: "usage", inputTokens: 390, outputTokens: 10 },
    ]);
    ai.script([
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "paid" } },
      },
      { type: "usage", inputTokens: 420, outputTokens: 10 },
    ]);
    const result = await support.run({ messages: ask("list"), user: member });
    expect(result.reason).toBe("length");
    expect(ai.requests).toHaveLength(2);
    const sent = ai.requests[1].messages.at(-1);
    expect(sent?.content).toContain(AI_TURN_WRAP_UP);
    const last = result.messages.at(-1);
    expect(last).toMatchObject({ role: "tool", callId: "c2", isError: true });
    expect(last?.content).toBe(AI_TURN_SPENT);
  });

  it("ends with the answer of the last call under a turn's tokenBudget", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ turnTokens: 1_000_000 });
    ai.script([
      { type: "tool_call", id: "c1", name: "list", input: {} },
      { type: "usage", inputTokens: 300, outputTokens: 10 },
    ]);
    ai.script([
      { type: "text", text: "Two invoices." },
      { type: "usage", inputTokens: 320, outputTokens: 10 },
    ]);
    const result = await support.run({
      messages: ask("list"),
      user: member,
      tokenBudget: 500,
    });
    expect(result.reason).toBe("stop");
    expect(result.text).toBe("Two invoices.");
    expect(ai.requests[1].messages.at(-1)?.content).toContain(AI_TURN_WRAP_UP);
  });

  it("counts a token read from the prompt cache as a tenth against turnTokens", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ turnTokens: 1000 });
    // 300 tokens a call. At full price the second call's results ask for
    // the answer (600 spent, two more calls do not fit) and the third call
    // is refused. The vendor serves 270 of them from its cache after the
    // first call: 300, then 57 a call, so every round fits.
    const cached = {
      inputTokens: 290,
      outputTokens: 10,
      cachedInputTokens: 270,
    };
    ai.script([
      { type: "tool_call", id: "c1", name: "list", input: {} },
      { type: "usage", inputTokens: 290, outputTokens: 10 },
    ]);
    ai.script([
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "open" } },
      },
      { type: "usage", ...cached },
    ]);
    ai.script([
      {
        type: "tool_call",
        id: "c3",
        name: "list",
        input: { query: { status: "paid" } },
      },
      { type: "usage", ...cached },
    ]);
    ai.script([
      { type: "text", text: "Three lists." },
      { type: "usage", ...cached },
    ]);

    const result = await support.run({ messages: ask("list"), user: member });

    expect(result.reason).toBe("stop");
    expect(result.text).toBe("Three lists.");
    const results = result.messages.filter((it) => it.role === "tool");
    expect(results.map((it) => it.callId)).toEqual(["c1", "c2", "c3"]);
    expect(results.some((it) => it.isError)).toBe(false);
    expect(results.some((it) => it.content.includes(AI_TURN_WRAP_UP))).toBe(
      false,
    );
  });

  it("expects the next call to read back what this one wrote to the cache", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ turnTokens: 1000 });
    // A first call of 400 tokens on a cold cache: at that price two more
    // calls do not fit, and the turn would get one round. It wrote 360 of
    // them to the cache, so the next call weighs 76.
    ai.script([
      { type: "tool_call", id: "c1", name: "list", input: {} },
      {
        type: "usage",
        inputTokens: 390,
        outputTokens: 10,
        cacheWriteInputTokens: 360,
      },
    ]);
    ai.script([
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "open" } },
      },
      {
        type: "usage",
        inputTokens: 390,
        outputTokens: 10,
        cachedInputTokens: 360,
      },
    ]);
    ai.script([{ type: "text", text: "Two lists." }]);

    const result = await support.run({ messages: ask("list"), user: member });

    expect(result.text).toBe("Two lists.");
    expect(
      result.messages.some((it) => it.content.includes(AI_TURN_WRAP_UP)),
    ).toBe(false);
  });

  it("still wraps up at turnTokens once the weighed calls add up to it", async ({
    expect,
  }) => {
    const { support, ai } = await setup({ turnTokens: 1000 });
    // 4000 tokens a call, 3600 of them cached: 760 a call. Two more do not
    // fit after the first, so its results ask for the answer.
    const cached = {
      inputTokens: 3990,
      outputTokens: 10,
      cachedInputTokens: 3600,
    };
    ai.script([
      { type: "tool_call", id: "c1", name: "list", input: {} },
      { type: "usage", ...cached },
    ]);
    ai.script([
      {
        type: "tool_call",
        id: "c2",
        name: "list",
        input: { query: { status: "open" } },
      },
      { type: "usage", ...cached },
    ]);

    const result = await support.run({ messages: ask("list"), user: member });

    expect(result.reason).toBe("length");
    expect(ai.requests[1].messages.at(-1)?.content).toContain(AI_TURN_WRAP_UP);
    expect(result.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "c2",
      isError: true,
    });
  });

  it("ends on the caller's abort signal", async ({ expect }) => {
    const { support } = await setup({}, true);
    const controller = new AbortController();
    const turn = support.run({
      messages: ask("x"),
      user: member,
      signal: controller.signal,
    });
    controller.abort(new Error("user left"));
    await expect(turn).rejects.toThrow("user left");
  });

  it("ends on the timeout", async ({ expect }) => {
    const { support } = await setup({ timeout: [20, "milliseconds"] }, true);
    await expect(
      support.run({ messages: ask("x"), user: member }),
    ).rejects.toThrow(/time/i);
  });
  it("offers only the tools a turn allows, and never runs another one", async ({
    expect,
  }) => {
    const { support, ai, api } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "purge",
        input: { params: { year: 2025 } },
      },
    ]);
    ai.script([{ type: "text", text: "Not available." }]);

    const result = await support.run({
      messages: ask("purge 2025"),
      user: { ...member, roles: ["admin"] },
      tools: ["list"],
    });

    // The model saw `list` only.
    expect(ai.requests[0].tools?.map((t) => t.name)).toEqual(["list"]);
    // A call outside the list is refused before it runs, even for an admin.
    const tool = result.messages[1] as any;
    expect(tool.isError).toBe(true);
    expect(tool.content).toMatch(/not available/);
    expect(api.created).toEqual([]);
  });

  it("takes the allow-list from the allow option, per user, and refuses an unoffered resume", async ({
    expect,
  }) => {
    const { support, ai, api } = await setup({
      allow: async ({ user }) =>
        user?.roles?.includes("admin") ? undefined : ["list", "create"],
    });
    ai.script([{ type: "text", text: "Hi." }]);
    await support.run({ messages: ask("hi"), user: member });
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["list", "create"]);

    ai.script([{ type: "text", text: "Hi." }]);
    await support.run({
      messages: ask("hi"),
      user: { ...member, roles: ["admin"] },
    });
    expect(ai.last!.tools?.map((t) => t.name)).toEqual([
      "list",
      "create",
      "purge",
      "navigate",
    ]);

    // A pause stored under a wider list is not run once the list narrows.
    const stored: AiMessage[] = [
      ...ask("bill 5"),
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c9", name: "create", input: { body: { amount: 5 } } },
        ],
      },
    ];
    ai.script([{ type: "text", text: "Cannot." }]);
    const resumed = await support.run({
      messages: stored,
      user: member,
      tools: ["list"],
      resume: { callId: "c9", decision: "approve" },
    });
    expect(api.created).toEqual([]);
    expect((resumed.messages[0] as any).isError).toBe(true);
  });
  it("hands allow the turn's page context, on a chat and on a resume", async ({
    expect,
  }) => {
    const seen: unknown[] = [];
    const { support, ai, api } = await setup({
      allow: ({ context }) => {
        seen.push(context?.data);
        return (context?.data as { canWrite?: boolean } | undefined)?.canWrite
          ? ["list", "create"]
          : ["list"];
      },
    });

    ai.script([{ type: "text", text: "Hi." }]);
    await support.run({
      messages: ask("hi"),
      user: member,
      context: { page: "invoices", data: { canWrite: false } },
    });
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["list"]);

    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "create",
        input: { body: { amount: 5 } },
      },
    ]);
    const paused = await support.run({
      messages: ask("bill 5"),
      user: member,
      context: { page: "invoices", data: { canWrite: true } },
    });
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["list", "create"]);
    expect(paused.pending).toMatchObject({ callId: "c1", kind: "confirm" });

    // Resumed under the context it paused in, the approved call is still
    // offered, so it runs.
    ai.script([{ type: "text", text: "Done." }]);
    await support.run({
      messages: [...ask("bill 5"), ...paused.messages.slice(1)],
      user: member,
      context: { page: "invoices", data: { canWrite: true } },
      resume: { callId: "c1", decision: "approve" },
    });
    expect(api.created).toEqual([{ by: "u1", amount: 5 }]);
    expect(seen).toEqual([
      { canWrite: false },
      { canWrite: true },
      { canWrite: true },
    ]);
  });
});
