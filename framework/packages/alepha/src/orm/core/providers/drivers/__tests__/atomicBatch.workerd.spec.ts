import { describe, it } from "vitest";

import { withWorkerd } from "../../../../../ai/core/__tests__/workerdHarness.ts";

/**
 * `atomicBatch` on D1, in workerd: the binding's native batch, with more
 * than 100 statements in one call (the framework sets no cap), and a batch
 * whose last statement fails rolling back the ones before it.
 */
describe("CloudflareD1Provider.atomicBatch (workerd)", () => {
  it("runs 150 statements as one batch, and rolls a failing batch back whole", async ({
    expect,
  }) => {
    const result = await withWorkerd(
      {
        name: "d1-atomic-batch",
        config: { env: { DB: { type: "d1", id: "d1-atomic-batch-test" } } },
        setup: async (mf) => {
          const db = await mf.getD1Database("DB");
          await db
            .prepare(
              "CREATE TABLE items (id INTEGER PRIMARY KEY, n INTEGER NOT NULL UNIQUE)",
            )
            .run();
        },
        source: `
import { Alepha, run } from "alepha";
import { AlephaOrm, DatabaseProvider, sql } from "alepha/orm";

const alepha = Alepha.create({ env: { DATABASE_URL: "d1://DB" } }).with(AlephaOrm);
const database = alepha.inject(DatabaseProvider);
const app = run(alepha);
let started = false;
const boot = async (env) => {
 if (started) return;
 started = true;
 app.set("cloudflare.env", env);
 await app.start();
};
const count = async () => Number((await database.execute(sql\`SELECT COUNT(*) AS n FROM items\`))[0].n);
export default { async fetch(request, env) {
 await boot(env);
 const statements = Array.from({ length: 150 }, (_, i) => sql\`INSERT INTO items (n) VALUES (\${i}) RETURNING n\`);
 const rows = await database.atomicBatch(statements);
 const afterBatch = await count();
 let failed = false;
 try {
  // The first insert is new, the second collides with n = 0: both or neither.
  await database.atomicBatch([sql\`INSERT INTO items (n) VALUES (1000)\`, sql\`INSERT INTO items (n) VALUES (0)\`]);
 } catch { failed = true; }
 return Response.json({
  driver: database.constructor.name,
  results: rows.length,
  last: rows[149][0].n,
  afterBatch,
  failed,
  afterFailure: await count(),
 });
} };
`,
      },
      async (dispatch) => (await dispatch({})).json(),
    );

    expect(result).toEqual({
      driver: "CloudflareD1Provider",
      results: 150,
      last: 149,
      afterBatch: 150,
      failed: true,
      afterFailure: 150,
    });
  });
});
