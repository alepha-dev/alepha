import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db, sql } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const counters = $entity({
  name: "test_upsert_many_counters",
  schema: z.object({
    id: db.primaryKey(),
    slug: z.text(),
    label: z.text(),
    hits: z.integer(),
  }),
  constraints: [{ columns: ["slug"], unique: true }],
});

class App {
  repository = $repository(counters);
}

/**
 * The whole reason `upsertMany` exists: a batch has to add up. The single-row
 * idiom `set: { hits: sql\`hits + 1\` }` adds one no matter how many the batch
 * carried, so a counter has to read the incoming value through `excluded`.
 */
const testAccumulatesThroughExcluded = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const t = app.repository.table;

  await app.repository.create({ slug: "home", label: "Home", hits: 5 });

  await app.repository.upsertMany(
    [
      { slug: "home", label: "Home", hits: 3 },
      { slug: "about", label: "About", hits: 2 },
    ],
    {
      target: ["slug"],
      set: { hits: sql`${t.hits} + excluded.hits` },
    },
  );

  const rows = await app.repository.findMany({ orderBy: "slug" });
  expect(rows.map((r) => [r.slug, r.hits])).toEqual([
    ["about", 2],
    ["home", 8],
  ]);
};

/**
 * Without an explicit `set`, one statement still carries exactly one
 * `DO UPDATE` clause — so it has to update each conflicting row from the values
 * that row arrived with, not from whichever row of the batch came first.
 */
const testDefaultSetUsesEachRowsOwnValues = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.createMany([
    { slug: "a", label: "old-a", hits: 1 },
    { slug: "b", label: "old-b", hits: 1 },
  ]);

  await app.repository.upsertMany(
    [
      { slug: "a", label: "new-a", hits: 10 },
      { slug: "b", label: "new-b", hits: 20 },
    ],
    { target: ["slug"] },
  );

  const rows = await app.repository.findMany({ orderBy: "slug" });
  expect(rows.map((r) => [r.slug, r.label, r.hits])).toEqual([
    ["a", "new-a", 10],
    ["b", "new-b", 20],
  ]);
};

const testEmptyIsANoop = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await expect(app.repository.upsertMany([])).resolves.toEqual([]);
};

/**
 * The engines disagree here, which is the whole reason callers must fold
 * duplicates themselves: Postgres refuses outright ("ON CONFLICT DO UPDATE
 * command cannot affect row a second time"), SQLite quietly applies them one
 * after another. Code written against SQLite therefore passes locally and
 * throws in Postgres — pinned in both directions so the divergence is a
 * documented fact rather than a surprise.
 */
const testDuplicateTargetsPostgres = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const t = app.repository.table;

  await expect(
    app.repository.upsertMany(
      [
        { slug: "dup", label: "one", hits: 1 },
        { slug: "dup", label: "two", hits: 1 },
      ],
      { target: ["slug"], set: { hits: sql`${t.hits} + excluded.hits` } },
    ),
  ).rejects.toThrow();
};

const testDuplicateTargetsSqlite = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const t = app.repository.table;

  await app.repository.upsertMany(
    [
      { slug: "dup", label: "one", hits: 1 },
      { slug: "dup", label: "two", hits: 1 },
    ],
    { target: ["slug"], set: { hits: sql`${t.hits} + excluded.hits` } },
  );

  // Applied sequentially: inserted at 1, then the second row conflicted and
  // added its own 1. Correct arithmetic, but do not rely on it — Postgres
  // rejects the same statement.
  const [row] = await app.repository.findMany({ where: { slug: "dup" } });
  expect(row.hits).toBe(2);
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });

describe("upsertMany", () => {
  it("accumulates counters through excluded (sqlite)", async () => {
    await testAccumulatesThroughExcluded(sqlite());
  });

  it("accumulates counters through excluded (postgres)", async () => {
    await testAccumulatesThroughExcluded(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("defaults each conflicting row to its own values (sqlite)", async () => {
    await testDefaultSetUsesEachRowsOwnValues(sqlite());
  });

  it("defaults each conflicting row to its own values (postgres)", async () => {
    await testDefaultSetUsesEachRowsOwnValues(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("treats an empty batch as a no-op (sqlite)", async () => {
    await testEmptyIsANoop(sqlite());
  });

  it("rejects duplicate conflict targets in one batch (postgres)", async () => {
    await testDuplicateTargetsPostgres(Alepha.create().with(AlephaOrmPostgres));
  });

  it("applies duplicate conflict targets sequentially (sqlite)", async () => {
    await testDuplicateTargetsSqlite(sqlite());
  });
});
