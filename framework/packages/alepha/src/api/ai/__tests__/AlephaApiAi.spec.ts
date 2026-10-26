import { Alepha, z } from "alepha";
import { $ai, AiProvider, clientTool, MemoryAiProvider } from "alepha/ai";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  $secure,
  AlephaSecurity,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  AiController,
  AiConversationService,
  AiJobs,
  AiSettings,
  AlephaApiAi,
  aiConversationEntity,
  aiMessageEntity,
  type AiStreamEvent,
} from "../index.ts";

/**
 * Resolves the caller from an `x-user` header, so HTTP calls carry an
 * identity without minting tokens.
 */
class HeaderSecurityProvider extends SecurityProvider {
  public override async resolveUserFromServerRequest(request: {
    headers: Record<string, string | undefined>;
  }): Promise<UserAccountToken | undefined> {
    const id = request.headers["x-user"];
    return id ? { id, realm: "default", roles: ["member"] } : undefined;
  }
}

class InvoiceApi {
  public created: Array<{ by: string; amount: number }> = [];

  list = $action({
    method: "GET",
    path: "/invoices",
    description: "List the invoices of the signed-in user",
    use: [$secure()],
    schema: { response: z.array(z.object({ id: z.integer() })) },
    handler: () => [{ id: 1 }, { id: 2 }],
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
}

class Rows {
  conversations = $repository(aiConversationEntity);
  messages = $repository(aiMessageEntity);
}

const boot = async (db: "sqlite" | "postgres" = "sqlite") => {
  const alepha = (
    db === "sqlite"
      ? Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
      : Alepha.create().with(AlephaOrmPostgres)
  )
    .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
    .with(AlephaSecurity)
    .with(AlephaApiAi);

  const api = alepha.inject(InvoiceApi);
  class Assistant {
    support = $ai({
      system: "You help with invoices.",
      tools: [
        api.list,
        api.create,
        clientTool("navigate", {
          description: "Open a page",
          schema: z.object({ page: z.text() }),
        }),
      ],
    });
  }
  alepha.inject(Assistant);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const controller = alepha.inject(AiController);
  const as = (user: string) => ({ "x-user": user });
  const read = async (res: { status: number } & AsyncIterable<unknown>) => {
    const events: AiStreamEvent[] = [];
    for await (const event of res) {
      events.push(event as AiStreamEvent);
    }
    return events;
  };

  return {
    alepha,
    api,
    rows,
    controller,
    ai: alepha.inject(AiProvider) as MemoryAiProvider,
    settings: alepha.inject(AiSettings),
    service: alepha.inject(AiConversationService),
    chat: (user: string, body: Record<string, unknown>) =>
      controller.chat.fetch({ headers: as(user), body: body as any }),
    resume: (user: string, id: string, body: Record<string, unknown>) =>
      controller.resume.fetch({
        headers: as(user),
        params: { id },
        body: body as any,
      }),
    read,
    member: (id: string): UserAccountToken => ({
      id,
      realm: "default",
      roles: ["member"],
    }),
  };
};

describe("alepha/api/ai", () => {
  it("streams a turn and persists each message, with tokens on the assistant row", async ({
    expect,
  }) => {
    const { chat, read, ai, rows } = await boot();
    ai.script([
      { type: "text", text: "Hello " },
      { type: "text", text: "there." },
      { type: "usage", inputTokens: 30, outputTokens: 4 },
    ]);

    const res = await chat("u1", { message: "hi" });
    expect(res.status).toBe(200);
    const events = await read(res);

    expect(events[0]).toMatchObject({ type: "conversation" });
    expect(events.filter((e) => e.type === "text").map((e) => e.text)).toEqual([
      "Hello ",
      "there.",
    ]);
    expect(events.at(-1)).toEqual({ type: "end", reason: "stop" });

    const stored = await rows.messages.findMany({
      orderBy: { column: "seq", direction: "asc" },
    });
    expect(stored.map((m) => [m.seq, m.role, m.content])).toEqual([
      [0, "user", "hi"],
      [1, "assistant", "Hello there."],
    ]);
    expect(stored[1]).toMatchObject({
      userId: "u1",
      model: "memory",
      inputTokens: 30,
      outputTokens: 4,
    });
  });

  it("stores the page context with the message and strips it from the detail", async ({
    expect,
  }) => {
    const { chat, read, controller, rows, member } = await boot();
    const events = await read(
      await chat("u1", {
        message: "what is this?",
        context: { route: "/invoices/7", data: { id: 7 } },
      }),
    );
    const id = events[0].conversationId!;
    const [user] = await rows.messages.findMany({ where: { seq: { eq: 0 } } });
    expect(user.content).toContain("<page-context>");

    const detail = await controller.getConversation.run(
      { params: { id } },
      { user: member("u1") },
    );
    expect(detail.messages[0].content).toBe("what is this?");
  });

  it("pauses a mutation, stores the pending call, and runs the stored input on approve", async ({
    expect,
  }) => {
    const { chat, resume, read, ai, api, rows } = await boot();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "create",
        input: { body: { amount: 120 } },
      },
    ]);

    const first = await read(await chat("u1", { message: "bill 120" }));
    const id = first[0].conversationId!;
    expect(first.slice(-2)).toEqual([
      {
        type: "confirm",
        callId: "c1",
        name: "create",
        input: { body: { amount: 120 } },
      },
      { type: "end", reason: "paused" },
    ]);
    const [paused] = await rows.conversations.findMany({});
    expect(paused.pendingCallId).toBe("c1");
    expect(api.created).toEqual([]);

    ai.script([{ type: "text", text: "Created invoice 3." }]);
    const res = await resume("u1", id, { callId: "c1", decision: "approve" });
    expect(res.status).toBe(200);
    const second = await read(res);

    expect(api.created).toEqual([{ by: "u1", amount: 120 }]);
    expect(second).toContainEqual({
      type: "tool_result",
      callId: "c1",
      name: "create",
      isError: false,
    });
    expect(second.at(-1)).toEqual({ type: "end", reason: "stop" });
    const [after] = await rows.conversations.findMany({});
    expect(after.pendingCallId ?? null).toBeNull();
  });

  it("refuses a wrong callId, a second approval, and another user's conversation, before the stream opens", async ({
    expect,
  }) => {
    const { chat, resume, read, ai, api } = await boot();
    ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "create",
        input: { body: { amount: 5 } },
      },
    ]);
    const id = (await read(await chat("u1", { message: "bill 5" })))[0]
      .conversationId!;

    expect(
      (await resume("u1", id, { callId: "forged", decision: "approve" }))
        .status,
    ).toBe(409);
    expect(
      (await resume("u2", id, { callId: "c1", decision: "approve" })).status,
    ).toBe(404);
    expect((await resume("u1", id, { callId: "c1" })).status).toBe(400);

    ai.script([{ type: "text", text: "ok" }]);
    await read(await resume("u1", id, { callId: "c1", decision: "deny" }));
    expect(
      (await resume("u1", id, { callId: "c1", decision: "approve" })).status,
    ).toBe(409);
    expect(api.created).toEqual([]);

    expect(
      (await chat("u2", { conversationId: id, message: "mine?" })).status,
    ).toBe(404);
  });

  it("resumes a client tool with its result", async ({ expect }) => {
    const { chat, resume, read, ai } = await boot();
    ai.script([
      {
        type: "tool_call",
        id: "n1",
        name: "navigate",
        input: { page: "invoices" },
      },
    ]);
    const first = await read(await chat("u1", { message: "show invoices" }));
    expect(first.at(-2)).toMatchObject({ type: "client_tool", callId: "n1" });

    ai.script([{ type: "text", text: "There." }]);
    const second = await read(
      await resume("u1", first[0].conversationId!, {
        callId: "n1",
        result: { ok: true },
      }),
    );
    expect(second).toContainEqual({ type: "text", text: "There." });
    expect(
      (
        await chat("u1", {
          conversationId: first[0].conversationId,
          message: "x",
        })
      ).status,
    ).toBe(200);
  });

  it("scopes the list and the detail to the owner; another user's is a 404", async ({
    expect,
  }) => {
    const { chat, read, controller, member } = await boot();
    const mine = (
      await read(await chat("u1", { message: "first question" }))
    )[0].conversationId!;
    await read(await chat("u2", { message: "someone else" }));

    const list = await controller.listConversations.run(
      {},
      { user: member("u1") },
    );
    expect(list.map((c) => [c.id, c.title])).toEqual([
      [mine, "first question"],
    ]);

    await expect(
      controller.getConversation.run(
        { params: { id: mine } },
        { user: member("u2") },
      ),
    ).rejects.toThrow("Conversation not found");
  });

  it("refuses a turn past the per-user token budget with a typed 429", async ({
    expect,
  }) => {
    const { chat, read, ai, settings } = await boot();
    await settings.parameter.set({ ...settings.current, budgetTokens: 100 });
    ai.script([
      { type: "text", text: "a" },
      { type: "usage", inputTokens: 90, outputTokens: 20 },
    ]);
    await read(await chat("u1", { message: "one" }));

    const refused = await chat("u1", { message: "two" });
    expect(refused.status).toBe(429);
    const body = await refused.response.json();
    expect(body).toMatchObject({ name: "AI_BUDGET_EXCEEDED" });
    // Per user: another user still has a budget.
    expect((await chat("u2", { message: "hi" })).status).toBe(200);
  });

  it("caps turns per minute per user", async ({ expect }) => {
    const { chat, read, settings } = await boot();
    await settings.parameter.set({ ...settings.current, turnsPerMinute: 2 });
    await read(await chat("u1", { message: "one" }));
    await read(await chat("u1", { message: "two" }));
    expect((await chat("u1", { message: "three" })).status).toBe(429);
    expect((await chat("u2", { message: "one" })).status).toBe(200);
  });

  it("purges conversations idle past retentionDays, and keeps them when unset", async ({
    expect,
  }) => {
    const { alepha, chat, read, rows, settings } = await boot();
    await read(await chat("u1", { message: "old" }));
    const jobs = alepha.inject(AiJobs);
    const dateTime = alepha.inject(DateTimeProvider);

    await dateTime.travel([10, "days"]);
    await jobs.purgeConversations.trigger();
    expect(await rows.conversations.count()).toBe(1);

    await settings.parameter.set({ ...settings.current, retentionDays: 7 });
    await jobs.purgeConversations.trigger();
    expect(await rows.conversations.count()).toBe(0);
    expect(await rows.messages.count()).toBe(0);
  });
});

describe("alepha/api/ai entities", () => {
  for (const db of ["sqlite", "postgres"] as const) {
    it(`store, sum and purge on ${db}`, async ({ expect }) => {
      const { service, rows } = await boot(db);
      const conversation = await service.create("u1", "a title");
      await service.append(conversation, 0, { role: "user", content: "q" });
      await service.append(
        conversation,
        1,
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "list", input: { query: {} } }],
          vendor: { provider: "anthropic", data: { thinking: [] } },
        },
        { usage: { inputTokens: 10, outputTokens: 5 }, model: "m" },
      );
      await service.append(conversation, 2, {
        role: "tool",
        callId: "c1",
        name: "list",
        content: "[]",
        isError: true,
      });

      expect(await service.history(conversation.id)).toEqual([
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "list", input: { query: {} } }],
          vendor: { provider: "anthropic", data: { thinking: [] } },
        },
        {
          role: "tool",
          callId: "c1",
          name: "list",
          content: "[]",
          isError: true,
        },
      ]);
      expect(await service.tokensSince("u1", "2000-01-01T00:00:00.000Z")).toBe(
        15,
      );
      expect(await service.tokensSince("u2", "2000-01-01T00:00:00.000Z")).toBe(
        0,
      );

      await service.pause(conversation.id, {
        callId: "c9",
        name: "create",
        input: { body: { amount: 1 } },
        kind: "confirm",
      });
      expect(await service.claim(conversation.id, "c9")).toBe(true);
      expect(await service.claim(conversation.id, "c9")).toBe(false);

      expect(await service.purge("2999-01-01T00:00:00.000Z")).toBe(1);
      expect(await rows.messages.count()).toBe(0);
    });
  }
});
