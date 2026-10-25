import { $inject, Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { DatabaseProvider } from "../core/providers/drivers/DatabaseProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * `opts.cache` must never serve rows a transaction did not commit, nor keep
 * rows a commit replaced. Against Postgres, so a read on the pool is a real
 * concurrent reader that cannot see the transaction's writes.
 */

const notes = $entity({
  name: "query_cache_tx_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.text(),
  }),
});

class App {
  notes = $repository(notes);
  db = $inject(DatabaseProvider);
}

class Rollback extends Error {}

const cache = { ttl: 60_000 };

describe("query cache and transactions", () => {
  const alepha = Alepha.create().with(AlephaOrmPostgres);
  const app = alepha.inject(App);

  it("does not cache a read made inside a transaction that rolls back", async () => {
    await app.notes.deleteMany({});
    await expect(
      app.db.transactional(async () => {
        await app.notes.create({ title: "uncommitted" });
        const inside = await app.notes.findMany({}, { cache });
        expect(inside.map((it) => it.title)).toEqual(["uncommitted"]);
        throw new Rollback("roll back");
      }),
    ).rejects.toThrow(Rollback);

    const after = await app.notes.findMany({}, { cache });
    expect(after).toEqual([]);
  });

  it("does not let a concurrent reader re-cache the rows a commit replaced", async () => {
    await app.notes.deleteMany({});
    const row = await app.notes.create({ title: "before" });

    await app.db.transactional(async () => {
      await app.notes.updateById(row.id as number, { title: "after" });
      // A reader outside the transaction, between the write and the COMMIT:
      // it sees the committed rows and caches them.
      const concurrent = await app.notes.findMany({}, { cache, tx: null });
      expect(concurrent.map((it) => it.title)).toEqual(["before"]);
    });

    const after = await app.notes.findMany({}, { cache });
    expect(after.map((it) => it.title)).toEqual(["after"]);
  });

  it("returns a copy on a hit, so mutating a result does not touch the cache", async () => {
    await app.notes.deleteMany({});
    await app.notes.create({ title: "original" });

    const first = await app.notes.findMany({}, { cache });
    first[0].title = "mutated";

    const second = await app.notes.findMany({}, { cache });
    expect(second.map((it) => it.title)).toEqual(["original"]);
  });
});
