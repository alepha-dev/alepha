import { $inject, Alepha, z } from "alepha";
import { $tool, AlephaMcp } from "alepha/mcp";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  $ai,
  AiProvider,
  AlephaAi,
  type AiMessage,
  type AiTurnEvent,
  MemoryAiProvider,
} from "../index.ts";

const member = { id: "u1", realm: "default", roles: ["member"] };

/**
 * What the tools saw, for the assertions.
 */
class Probe {
  aborted?: unknown;
  started?: () => void;
  ready?: Promise<void>;
  renamed: string[] = [];
}

class QuestTools {
  protected readonly alepha = $inject(Alepha);
  protected readonly probe = $inject(Probe);

  quest_get = $tool({
    description: "Read one quest",
    annotations: { readOnlyHint: true },
    use: [$secure()],
    schema: {
      params: z.object({
        shortId: z.integer(),
        detail: z.enum(["summary", "full"]).default("summary"),
      }),
      result: z.object({ id: z.integer(), owner: z.text() }),
    },
    handler: ({ params, user }) => ({ id: params.shortId, owner: user.id }),
  });

  quest_rename = $tool({
    description: "Rename a quest",
    use: [$secure()],
    schema: { params: z.object({ shortId: z.integer(), title: z.text() }) },
    handler: ({ params }) => {
      this.probe.renamed.push(params.title);
      return "renamed";
    },
  });

  quest_purge = $tool({
    description: "Purge every quest (admin only)",
    annotations: { readOnlyHint: true },
    use: [$secure({ roles: ["admin"] })],
    handler: () => "purged",
  });

  quest_wait = $tool({
    description: "Wait until cancelled",
    annotations: { readOnlyHint: true },
    handler: async ({ context }) => {
      const signal = context!.signal!;
      this.probe.started?.();
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      this.probe.aborted = signal.reason;
      return "late";
    },
  });
}

class InvoiceApi {
  list = $action({
    method: "GET",
    path: "/invoices",
    description: "List the invoices of the signed-in user",
    use: [$secure()],
    schema: { response: z.array(z.object({ id: z.integer() })) },
    handler: () => [{ id: 1 }],
  });
}

const setup = async (options: Partial<Parameters<typeof $ai>[0]> = {}) => {
  const alepha = Alepha.create()
    .with(AlephaSecurity)
    .with(AlephaMcp)
    .with(AlephaAi);
  const tools = alepha.inject(QuestTools);
  const api = alepha.inject(InvoiceApi);

  class Assistant {
    support = $ai({
      system: "You help with quests.",
      tools: [
        tools.quest_get,
        tools.quest_rename,
        tools.quest_purge,
        tools.quest_wait,
        api.list,
      ],
      ...options,
    });
  }

  const assistant = alepha.inject(Assistant);
  await alepha.start();
  return {
    alepha,
    probe: alepha.inject(Probe),
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

describe("$ai({ tools }) with a $tool", () => {
  it("offers a $tool by its name, description and params, in input mode", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    await support.run({ messages: ask("hi"), user: member });

    const tools = ai.last!.tools!;
    expect(tools.map((t) => t.name)).toEqual([
      "quest_get",
      "quest_rename",
      "quest_purge",
      "quest_wait",
      "list",
    ]);
    expect(tools[0]).toEqual({
      name: "quest_get",
      description: "Read one quest",
      inputSchema: {
        type: "object",
        properties: {
          shortId: {
            type: "integer",
            minimum: expect.any(Number),
            maximum: expect.any(Number),
          },
          detail: {
            type: "string",
            enum: ["summary", "full"],
            default: "summary",
          },
        },
        required: ["shortId"],
      },
    });
    // A $tool with no params takes an empty object.
    expect(tools[2].inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("runs a read-only $tool at once, as the turn's user, beside an action", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      { type: "tool_call", id: "c1", name: "quest_get", input: { shortId: 7 } },
      { type: "tool_call", id: "c2", name: "list", input: {} },
    ]);
    ai.script([{ type: "text", text: "Quest 7 is yours." }]);

    const result = await support.run({
      messages: ask("quest 7?"),
      user: member,
    });

    expect(result.reason).toBe("stop");
    expect(result.messages[1]).toEqual({
      role: "tool",
      callId: "c1",
      name: "quest_get",
      content: JSON.stringify({ id: 7, owner: "u1" }),
    });
    expect(result.messages[2]).toEqual({
      role: "tool",
      callId: "c2",
      name: "list",
      content: JSON.stringify([{ id: 1 }]),
    });
  });

  it("returns a $secure refusal to the model as a tool error", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      { type: "tool_call", id: "c1", name: "quest_purge", input: {} },
      { type: "tool_call", id: "c2", name: "quest_get", input: { shortId: 1 } },
    ]);
    ai.script([{ type: "text", text: "No." }]);

    const forbidden = await support.run({
      messages: ask("purge"),
      user: member,
    });
    expect(forbidden.messages[1]).toMatchObject({
      isError: true,
      content: expect.stringMatching(/Forbidden/i),
    });

    ai.script([
      { type: "tool_call", id: "c3", name: "quest_get", input: { shortId: 1 } },
    ]);
    ai.script([{ type: "text", text: "Sign in." }]);
    const anonymous = await support.run({ messages: ask("quest 1") });
    expect(anonymous.messages[1]).toMatchObject({
      isError: true,
      content: expect.stringMatching(/Unauthorized/i),
    });
  });

  it("returns invalid arguments to the model as a tool error", async ({
    expect,
  }) => {
    const { support, ai } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "quest_get",
        input: { shortId: "seven" },
      },
    ]);
    ai.script([{ type: "text", text: "Retrying." }]);

    const result = await support.run({ messages: ask("x"), user: member });

    expect(result.messages[1]).toMatchObject({ isError: true });
  });

  it("waits for confirmation on a $tool without readOnlyHint, with method TOOL", async ({
    expect,
  }) => {
    const asked: Array<{ name: string; method: string }> = [];
    const { support, ai, probe } = await setup({
      confirm: (tool) => {
        asked.push(tool);
        return tool.method === "TOOL";
      },
    });
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "quest_rename",
        input: { shortId: 1, title: "New" },
      },
    ]);

    const first = await collect(
      support.stream({ messages: ask("rename"), user: member }),
    );
    expect(first.at(-2)).toMatchObject({ type: "confirm", callId: "c1" });
    expect(asked).toEqual([{ name: "quest_rename", method: "TOOL" }]);
    expect(probe.renamed).toEqual([]);

    const stored: AiMessage[] = [
      ...ask("rename"),
      ...first
        .filter((e) => e.type === "message")
        .map((e) => (e as { message: AiMessage }).message),
    ];
    ai.script([{ type: "text", text: "Renamed." }]);
    const resumed = await support.run({
      messages: stored,
      user: member,
      resume: { callId: "c1", decision: "approve" },
    });

    expect(probe.renamed).toEqual(["New"]);
    expect(resumed.messages[0]).toMatchObject({
      role: "tool",
      callId: "c1",
      content: "renamed",
    });
  });

  it("by default, confirms a $tool unless it is readOnlyHint", async ({
    expect,
  }) => {
    const { support, ai, probe } = await setup();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "quest_rename",
        input: { shortId: 1, title: "New" },
      },
    ]);

    const events = await collect(
      support.stream({ messages: ask("rename"), user: member }),
    );

    expect(events.at(-2)).toMatchObject({ type: "confirm", callId: "c1" });
    expect(probe.renamed).toEqual([]);
  });

  it("filters $tools by name with allow and a turn's tools", async ({
    expect,
  }) => {
    const { support, ai } = await setup({
      allow: () => ["quest_get", "list"],
    });
    ai.script([
      { type: "tool_call", id: "c1", name: "quest_purge", input: {} },
    ]);
    ai.script([{ type: "text", text: "Not offered." }]);

    const allowed = await support.run({ messages: ask("x"), user: member });
    expect(ai.requests[0].tools?.map((t) => t.name)).toEqual([
      "quest_get",
      "list",
    ]);
    expect(allowed.messages[1]).toMatchObject({
      isError: true,
      content: expect.stringMatching(/not available/),
    });

    await support.run({
      messages: ask("y"),
      user: member,
      tools: ["quest_wait"],
    });
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["quest_wait"]);
  });

  it("aborts the $tool's context signal when the turn is aborted", async ({
    expect,
  }) => {
    const { support, ai, probe } = await setup();
    probe.ready = new Promise((resolve) => {
      probe.started = resolve;
    });
    ai.script([{ type: "tool_call", id: "c1", name: "quest_wait", input: {} }]);

    const controller = new AbortController();
    const turn = support
      .run({ messages: ask("wait"), user: member, signal: controller.signal })
      .catch((error: unknown) => error);
    await probe.ready;
    controller.abort(new Error("user left"));
    await turn;

    expect(probe.aborted).toBeInstanceOf(Error);
    expect((probe.aborted as Error).message).toBe("user left");
  });

  it("refuses a $tool whose name a vendor would refuse, at start", async ({
    expect,
  }) => {
    class Dotted {
      dotted = $tool({
        name: "quest.get",
        description: "x",
        handler: () => "x",
      });
    }
    const alepha = Alepha.create().with(AlephaMcp).with(AlephaAi);
    const dotted = alepha.inject(Dotted);
    class Assistant {
      support = $ai({ system: "x", tools: [dotted.dotted] });
    }
    expect(() => alepha.inject(Assistant)).toThrow("Invalid AI tool name");
  });
});
