import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, expect, it } from "vitest";

import { sql } from "../../../index.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";

/**
 * `atomicBatch`: all of the statements apply, or none does, and inside an
 * open transaction they join it instead of opening another.
 */
const atomic = async (alepha: Alepha) => {
  const database = alepha.inject(DatabaseProvider);
  await alepha.start();
  const table = `atomic_batch_${Math.random().toString(36).slice(2, 8)}`;
  const t = sql.identifier(table);
  await database.execute(
    sql`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, n INTEGER NOT NULL UNIQUE)`,
  );
  const count = async () =>
    Number((await database.execute(sql`SELECT COUNT(*) AS n FROM ${t}`))[0].n);

  expect(await database.atomicBatch([])).toEqual([]);

  // Rows per statement, in order.
  const rows = await database.atomicBatch([
    sql`INSERT INTO ${t} (id, n) VALUES (1, 1) RETURNING n`,
    sql`INSERT INTO ${t} (id, n) VALUES (2, 2) RETURNING n`,
  ]);
  expect(rows.map((it) => Number(it[0].n))).toEqual([1, 2]);

  // The second collides: the first is rolled back with it.
  await expect(
    database.atomicBatch([
      sql`INSERT INTO ${t} (id, n) VALUES (3, 3)`,
      sql`INSERT INTO ${t} (id, n) VALUES (4, 1)`,
    ]),
  ).rejects.toThrow();
  expect(await count()).toBe(2);

  // Inside an open transaction: no nested BEGIN, and the block's rollback
  // takes the batch with it.
  await expect(
    database.transactional(async () => {
      await database.atomicBatch([
        sql`INSERT INTO ${t} (id, n) VALUES (5, 5)`,
        sql`INSERT INTO ${t} (id, n) VALUES (6, 6)`,
      ]);
      expect(await count()).toBe(4);
      throw new Error("abort the block");
    }),
  ).rejects.toThrow("abort the block");
  expect(await count()).toBe(2);
  await alepha.stop();
};

describe("DatabaseProvider.atomicBatch", () => {
  it("applies all or nothing, and joins an open transaction (sqlite)", async () => {
    await atomic(Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }));
  });

  it("applies all or nothing, and joins an open transaction (postgres)", async () => {
    await atomic(Alepha.create().with(AlephaOrmTestPostgres));
  });

  it("stays atomic on sqlite with ordinary transactions switched off", async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", DATABASE_TRANSACTIONS: false },
    });
    const database = alepha.inject(DatabaseProvider);
    await alepha.start();
    expect(database.supportsTransactions).toBe(false);
    await database.execute(
      sql`CREATE TABLE atomic_off (id INTEGER PRIMARY KEY, n INTEGER NOT NULL UNIQUE)`,
    );
    await database.execute(sql`INSERT INTO atomic_off (id, n) VALUES (1, 1)`);
    await expect(
      database.atomicBatch([
        sql`INSERT INTO atomic_off (id, n) VALUES (2, 2)`,
        sql`INSERT INTO atomic_off (id, n) VALUES (3, 1)`,
      ]),
    ).rejects.toThrow();
    const [{ n }] = await database.execute(
      sql`SELECT COUNT(*) AS n FROM atomic_off`,
    );
    expect(Number(n)).toBe(1);
    await alepha.stop();
  });
});
