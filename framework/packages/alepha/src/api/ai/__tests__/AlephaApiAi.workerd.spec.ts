import { Alepha } from "alepha";
import { DatabaseProvider, DrizzleKitProvider } from "alepha/orm";
import { describe, it } from "vitest";

import { withWorkerd } from "../../../ai/core/__tests__/workerdHarness.ts";
import { AlephaApiAi } from "../index.ts";

/**
 * The chat and resume streams on workerd, against D1: the same `$sse`
 * endpoints, `$secure`, the `$ai` loop paused and resumed across two
 * requests with nothing kept in memory between them.
 *
 * D1 is not migrated on Workers (migrations are applied by the deploy), so
 * the tables are created first from the statements the ORM generates for
 * this module on SQLite, the dialect D1 speaks.
 */
describe("alepha/api/ai (workerd)", () => {
  it("streams a turn, pauses on a mutation and resumes it in a second request, on D1", async ({
    expect,
  }) => {
    const node = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaApiAi);
    const { statements } = await node
      .inject(DrizzleKitProvider)
      .generateMigration(node.inject(DatabaseProvider));

    const result = await withWorkerd(
      {
        name: "api-ai",
        config: {
          env: {
            DB: { type: "d1", id: "api-ai-test" },
            // The rate limiter's counters are actor state: on workerd, a
            // Durable Object, as the Cloudflare build declares it.
            ALEPHA_ACTOR: {
              type: "durable-object",
              worker: "api-ai",
              exportName: "AlephaActorDurableObject",
            },
            APP_NAME: { type: "json", value: "api-ai" },
          },
          exports: {
            AlephaActorDurableObject: {
              type: "durable-object",
              storage: "sqlite",
            },
          },
        },
        setup: async (mf) => {
          const db = await mf.getD1Database("DB");
          for (const statement of statements) {
            await db.prepare(statement).run();
          }
        },
        source: `
import { Alepha, run, z } from "alepha";
import { ActorHostRuntime } from "alepha/actor";
export { AlephaActorDurableObject } from "alepha/actor";
import { $ai, AiProvider, MemoryAiProvider } from "alepha/ai";
import { AlephaApiAi } from "alepha/api/ai";
import { $secure, AlephaSecurity, SecurityProvider } from "alepha/security";
import { $action } from "alepha/server";

class HeaderSecurityProvider extends SecurityProvider {
 async resolveUserFromServerRequest(request) {
  const id = request.headers["x-user"];
  return id ? { id, realm: "default", roles: ["member"] } : undefined;
 }
}
const created = [];
class Api {
 create = $action({
  method: "POST", path: "/invoices", description: "Create an invoice", use: [$secure()],
  schema: { body: z.object({ amount: z.number() }), response: z.object({ id: z.integer() }) },
  handler: ({ body, user }) => { created.push({ by: user.id, amount: body.amount }); return { id: 3 }; },
 });
}
// At module scope, as a generated worker does: the Durable Object isolate
// loads this module too and finds the container there.
const app = run(Alepha.create({ env: { DATABASE_URL: "d1://DB" } })
 .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
 .with(AlephaSecurity)
 .with(AlephaApiAi));
const api = app.inject(Api);
class Assistant { support = $ai({ system: "s", tools: [api.create] }); }
app.inject(Assistant);
let started = false;
const boot = async (env) => {
 if (started) return app;
 started = true;
 app.set("cloudflare.env", env);
 await app.start();
 const ai = app.inject(AiProvider);
 ai.script([{ type: "text", text: "Billing " }, { type: "tool_call", id: "c1", name: "create", input: { body: { amount: 42 } } }, { type: "usage", inputTokens: 7, outputTokens: 3 }]);
 ai.script([{ type: "text", text: "Done." }]);
 return app;
};
export default { async fetch(request, env) {
 ActorHostRuntime.resolve(env);
 const app = await boot(env);
 if (new URL(request.url).pathname === "/created") return Response.json({ created, provider: app.inject(AiProvider) instanceof MemoryAiProvider });
 const ctx = { req: request };
 await app.events.emit("web:request:before", ctx);
 return ctx.res ?? new Response("no response", { status: 500 });
} };
`,
      },
      async (dispatch) => {
        const read = async (res: Response) => {
          const text = await res.text();
          return {
            status: res.status,
            events: text
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => JSON.parse(line.slice(6))),
          };
        };
        const headers = {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-user": "u1",
        };
        const anonymous = await dispatch(
          { message: "hi" },
          {
            path: "/api/ai/chat",
            headers: { "content-type": "application/json" },
          },
        );
        const first = await read(
          await dispatch(
            { message: "bill 42" },
            { path: "/api/ai/chat", headers },
          ),
        );
        const id = first.events[0].conversationId;
        const second = await read(
          await dispatch(
            { callId: "c1", decision: "approve" },
            { path: `/api/ai/conversations/${id}/resume`, headers },
          ),
        );
        const created = await (await dispatch({}, { path: "/created" })).json();
        return { anonymous: anonymous.status, first, second, created };
      },
    );

    expect(result.anonymous).toBe(401);
    expect(result.first.status).toBe(200);
    expect(result.first.events.map((e: any) => e.type)).toEqual([
      "conversation",
      "text",
      "confirm",
      "end",
    ]);
    expect(result.first.events[2]).toMatchObject({
      callId: "c1",
      input: { body: { amount: 42 } },
    });
    expect(result.second.status).toBe(200);
    expect(result.second.events.map((e: any) => e.type)).toEqual([
      "conversation",
      "tool_result",
      "text",
      "end",
    ]);
    expect(result.created).toEqual({
      created: [{ by: "u1", amount: 42 }],
      provider: true,
    });
  }, 120_000);
});
