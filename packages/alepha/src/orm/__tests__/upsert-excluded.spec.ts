import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * `hitCount` is stored as `hit_count`: a property whose physical name differs,
 * which a hand-typed `excluded.hitCount` gets wrong and `excluded("hitCount")`
 * resolves.
 */
const uniques = $entity({
  name: "test_upsert_excluded_uniques",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    visitor: z.text(),
    day: z.text(),
    hitCount: z.integer(),
  }),
  constraints: [{ columns: ["visitor"], unique: true }],
});

class App {
  uniques = $repository(uniques);
}

/**
 * The counter shape of Lore's `SigilIngestService.cappedSum`: one `upsertMany`
 * that adds each row's own incoming value.
 */
const testCounterThroughExcluded = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const t = app.uniques.table;

  await app.uniques.create({ visitor: "a", day: "2026-10-01", hitCount: 5 });

  await app.uniques.upsertMany(
    [
      { visitor: "a", day: "2026-10-01", hitCount: 3 },
      { visitor: "b", day: "2026-10-01", hitCount: 2 },
    ],
    {
      target: ["visitor"],
      set: {
        hitCount: sql`${t.hitCount} + ${app.uniques.excluded("hitCount")}`,
      },
    },
  );

  const rows = await app.uniques.findMany({ orderBy: "visitor" });
  expect(rows.map((r) => [r.visitor, r.hitCount])).toEqual([
    ["a", 8],
    ["b", 2],
  ]);
};

/**
 * The unique-visitor shape of Lore's `LoreAnalyticsStore`: `set` takes the
 * incoming value as it is, and the fragment renders the physical name.
 */
const testSetToIncomingValue = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.uniques.create({ visitor: "a", day: "2026-10-01", hitCount: 1 });

  await app.uniques.upsert(
    { visitor: "a", day: "2026-10-02", hitCount: 7 },
    {
      target: ["visitor"],
      set: {
        day: app.uniques.excluded("day"),
        hitCount: app.uniques.excluded("hitCount"),
      },
    },
  );

  const [row] = await app.uniques.findMany({ where: { visitor: { eq: "a" } } });
  expect([row.day, row.hitCount]).toEqual(["2026-10-02", 7]);

  const rendered = alepha
    .inject(App)
    .uniques.provider.db.select({ v: app.uniques.excluded("hitCount") })
    .from(app.uniques.table)
    .toSQL().sql;
  expect(rendered).toContain(`excluded."hit_count"`);
};

const testUnknownKeyThrows = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  expect(() => app.uniques.excluded("nope" as any)).toThrow(/nope/);
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

describe("Repository.excluded", () => {
  it("accumulates a counter through excluded() (sqlite)", async () => {
    await testCounterThroughExcluded(sqlite());
  });

  it("accumulates a counter through excluded() (postgres)", async () => {
    await testCounterThroughExcluded(postgres());
  });

  it("sets a column to its incoming value by physical name (sqlite)", async () => {
    await testSetToIncomingValue(sqlite());
  });

  it("sets a column to its incoming value by physical name (postgres)", async () => {
    await testSetToIncomingValue(postgres());
  });

  it("throws on a key that is not a column", async () => {
    await testUnknownKeyThrows(sqlite());
  });
});
