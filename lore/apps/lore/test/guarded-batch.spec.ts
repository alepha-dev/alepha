import { GuardedBatch, LoreDatabase } from "@lore/core/api";
import { Alepha } from "alepha";
import { DatabaseProvider, sql } from "alepha/orm";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The neutral guarded batch (#Q3899): a change and what must be written with
 * it, together or not at all, with a guard that needs no feature's table.
 * `alepha test --dialect postgres` runs it on Postgres.
 */
describe("GuardedBatch", () => {
  let alepha: Alepha;
  let batch: GuardedBatch;
  let provider: DatabaseProvider;
  const count = async (table = "guarded_batch_test") =>
    (
      await provider.execute(
        `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM ${table}`,
      )
    )[0];

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha, ["api"]);
    batch = alepha.inject(GuardedBatch);
    provider = alepha.inject(DatabaseProvider);
    await alepha.start();
    await alepha
      .inject(LoreDatabase)
      .batch([
        "CREATE TABLE guarded_batch_test (id TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL)",
      ]);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("commits every statement when the guard holds, and leaves no guard row", async ({
    expect,
  }) => {
    await batch.guarded(sql`TRUE`, [
      sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)`,
      sql`INSERT INTO guarded_batch_test (id, value) VALUES ('b', 2)`,
    ]);
    expect(await count()).toEqual({ n: 2 });
    expect(await count("batch_guards")).toEqual({ n: 0 });
  });

  it("aborts the whole batch when the guard is false", async ({ expect }) => {
    await expect(
      batch.guarded(sql`FALSE`, [
        sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)`,
      ]),
    ).rejects.toThrow("Atomic batch failed");
    expect(await count()).toEqual({ n: 0 });
    expect(await count("batch_guards")).toEqual({ n: 0 });
  });

  it("aborts the whole batch when a later statement fails", async ({
    expect,
  }) => {
    await expect(
      batch.guarded(sql`TRUE`, [
        sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)`,
        sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 2)`,
      ]),
    ).rejects.toThrow("Atomic batch failed");
    expect(await count()).toEqual({ n: 0 });
  });

  it("tells a false guard from a failed driver", async ({ expect }) => {
    // Both make `guarded` reject; only the first is a refusal a caller may
    // skip, and `holds` asks the database which one it was.
    const guard = sql`NOT EXISTS (SELECT 1 FROM guarded_batch_test WHERE id = 'a')`;
    expect(await batch.holds(guard)).toBe(true);
    await expect(
      batch.guarded(guard, [
        sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)`,
        sql`INSERT INTO guarded_batch_test (missing, value) VALUES ('b', 1)`,
      ]),
    ).rejects.toThrow("Atomic batch failed");
    expect(await batch.holds(guard)).toBe(true);
    await batch.guarded(guard, [
      sql`INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)`,
    ]);
    expect(await batch.holds(guard)).toBe(false);
  });

  it("lets one of two concurrent batches claim the same row", async ({
    expect,
  }) => {
    // A claim: the guard reads the value the caller saw, the batch moves it.
    // On Postgres each batch is a READ COMMITTED transaction, which alone
    // would let both guards read the old value before either committed.
    await provider.execute(
      "INSERT INTO guarded_batch_test (id, value) VALUES ('a', 1)",
    );
    const claim = () =>
      batch.guarded(
        sql`EXISTS (SELECT 1 FROM guarded_batch_test WHERE id = 'a' AND value = 1)`,
        [
          sql`UPDATE guarded_batch_test SET value = value + 1 WHERE id = 'a'`,
          sql`SELECT value FROM guarded_batch_test WHERE id = 'a'`,
        ],
      );
    const settled = await Promise.allSettled([claim(), claim(), claim()]);
    const won = settled.filter((it) => it.status === "fulfilled");
    expect(won).toHaveLength(1);
    expect(
      await provider.execute("SELECT value FROM guarded_batch_test"),
    ).toEqual([{ value: 2 }]);
    // The guard's insert answers first, then each statement in order.
    expect(won[0].value[2]).toEqual([{ value: 2 }]);
    expect(await count("batch_guards")).toEqual({ n: 0 });
  });
});
