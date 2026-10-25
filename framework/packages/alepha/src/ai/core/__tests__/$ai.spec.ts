import { Alepha, z } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  $ai,
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

  it("stops at maxSteps with end length", async ({ expect }) => {
    const { support, ai } = await setup({ maxSteps: 2 });
    for (let i = 0; i < 3; i++) {
      ai.script([{ type: "tool_call", id: `c${i}`, name: "list", input: {} }]);
    }
    const result = await support.run({ messages: ask("loop"), user: member });
    expect(result.reason).toBe("length");
    expect(ai.requests).toHaveLength(2);
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
});
