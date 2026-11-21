import { Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";

const counters = $entity({
  name: "test_upsert_many_counters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
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
 * `DO UPDATE` clause, so it has to update each conflicting row from the values
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
 * throws in Postgres: pinned in both directions so the divergence is a
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
  // added its own 1. Correct arithmetic, but do not rely on it: Postgres
  // rejects the same statement.
  const [row] = await app.repository.findMany({ where: { slug: "dup" } });
  expect(row.hits).toBe(2);
};

const archives = $entity({
  name: "test_upsert_many_archives",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    slug: z.text(),
    label: z.text(),
    deletedAt: db.deletedAt(),
  }),
  constraints: [{ columns: ["slug"], unique: true }],
});

class ArchiveApp {
  repository = $repository(archives);
}

/**
 * A row the `DO UPDATE` guard skipped comes back from neither branch of the
 * statement, so the only trace of it is a result shorter than the input.
 * `upsert` throws on the same conflict, and the two have to agree.
 */
const testRefusesSoftDeletedConflict = async (alepha: Alepha) => {
  const app = alepha.inject(ArchiveApp);
  await alepha.start();
  const live = await app.repository.create({ slug: "live", label: "Live" });
  const gone = await app.repository.create({ slug: "gone", label: "Gone" });
  await app.repository.deleteById(gone.id);

  await expect(
    app.repository.upsertMany(
      [
        { slug: "live", label: "Live, edited" },
        { slug: "gone", label: "Gone, edited" },
        { slug: "new", label: "New" },
      ],
      { target: ["slug"] },
    ),
  ).rejects.toThrow(/test_upsert_many_archives.*already-deleted/);

  const rows = await app.repository.findMany({}, { force: true });
  const labels = Object.fromEntries(rows.map((r) => [r.slug, r.label]));
  expect(labels.gone).toBe("Gone");
  expect(rows.find((r) => r.id === live.id)?.label).toBe("Live, edited");
};

const testForceOverwritesSoftDeleted = async (alepha: Alepha) => {
  const app = alepha.inject(ArchiveApp);
  await alepha.start();
  const gone = await app.repository.create({ slug: "gone", label: "Gone" });
  await app.repository.deleteById(gone.id);

  const rows = await app.repository.upsertMany(
    [{ slug: "gone", label: "Gone, edited" }],
    { target: ["slug"], force: true },
  );

  expect(rows.map((r) => r.label)).toEqual(["Gone, edited"]);
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });

describe("upsertMany", () => {
  it("throws on a soft-deleted conflict, as upsert does (sqlite)", async () => {
    await testRefusesSoftDeletedConflict(sqlite());
  });

  it("throws on a soft-deleted conflict, as upsert does (postgres)", async () => {
    await testRefusesSoftDeletedConflict(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("overwrites a soft-deleted row under force (sqlite)", async () => {
    await testForceOverwritesSoftDeleted(sqlite());
  });

  it("overwrites a soft-deleted row under force (postgres)", async () => {
    await testForceOverwritesSoftDeleted(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("accumulates counters through excluded (sqlite)", async () => {
    await testAccumulatesThroughExcluded(sqlite());
  });

  it("accumulates counters through excluded (postgres)", async () => {
    await testAccumulatesThroughExcluded(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("defaults each conflicting row to its own values (sqlite)", async () => {
    await testDefaultSetUsesEachRowsOwnValues(sqlite());
  });

  it("defaults each conflicting row to its own values (postgres)", async () => {
    await testDefaultSetUsesEachRowsOwnValues(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("treats an empty batch as a no-op (sqlite)", async () => {
    await testEmptyIsANoop(sqlite());
  });

  it("rejects duplicate conflict targets in one batch (postgres)", async () => {
    await testDuplicateTargetsPostgres(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("applies duplicate conflict targets sequentially (sqlite)", async () => {
    await testDuplicateTargetsSqlite(sqlite());
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const steps = $entity({
  name: "test_upsert_many_steps",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    slug: z.text(),
    // `order` is a reserved word on every dialect. The conflict target and the
    // insert column list were always quoted; the generated `excluded.<col>`
    // reference in the default SET was not, and failed to parse.
    order: z.integer(),
  }),
  constraints: [{ columns: ["slug"], unique: true }],
});

class StepsApp {
  repository = $repository(steps);
}

const testQuotesReservedWordColumns = async (alepha: Alepha) => {
  const app = alepha.inject(StepsApp);
  await alepha.start();

  await app.repository.create({ slug: "intro", order: 1 });

  await app.repository.upsertMany(
    [
      { slug: "intro", order: 3 },
      { slug: "outro", order: 4 },
    ],
    { target: ["slug"] },
  );

  const rows = await app.repository.findMany({ orderBy: "slug" });
  expect(rows.map((r) => [r.slug, r.order])).toEqual([
    ["intro", 3],
    ["outro", 4],
  ]);
};

const profiles = $entity({
  name: "test_upsert_many_profiles",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    slug: z.text(),
    label: z.text(),
    rank: z.integer().optional(),
    note: z.text().optional(),
  }),
  constraints: [{ columns: ["slug"], unique: true }],
});

class ProfileApp {
  repository = $repository(profiles);
}

/**
 * Without `set`, a conflicting row is updated from its OWN insert data: a
 * column the first row of the batch leaves out is still written for a later
 * row that provides it, and left alone for a row that does not.
 */
const testDefaultSetWithDifferentKeys = async (alepha: Alepha) => {
  const app = alepha.inject(ProfileApp);
  await alepha.start();

  await app.repository.createMany([
    { slug: "a", label: "old-a", rank: 1, note: "keep-a" },
    { slug: "b", label: "old-b", rank: 1, note: "keep-b" },
    { slug: "c", label: "old-c", rank: 1, note: "keep-c" },
  ]);

  const returned = await app.repository.upsertMany(
    [
      { slug: "a", label: "new-a" },
      { slug: "b", label: "new-b", rank: 99 },
      { slug: "c", label: "new-c", note: "new-note" },
      { slug: "d", label: "new-d", rank: 4 },
    ],
    { target: ["slug"] },
  );
  expect(returned).toHaveLength(4);

  const rows = await app.repository.findMany({ orderBy: "slug" });
  expect(rows.map((r) => [r.slug, r.label, r.rank, r.note])).toEqual([
    ["a", "new-a", 1, "keep-a"],
    ["b", "new-b", 99, "keep-b"],
    ["c", "new-c", 1, "new-note"],
    ["d", "new-d", 4, undefined],
  ]);
};

describe("upsertMany without set, rows with different columns", () => {
  it("updates each conflicting row from its own columns (sqlite)", async () => {
    await testDefaultSetWithDifferentKeys(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("updates each conflicting row from its own columns (postgres)", async () => {
    await testDefaultSetWithDifferentKeys(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });
});

describe("upsertMany on reserved-word columns", () => {
  it("quotes the generated excluded reference (sqlite)", async () => {
    await testQuotesReservedWordColumns(sqlite());
  });

  it("quotes the generated excluded reference (postgres)", async () => {
    await testQuotesReservedWordColumns(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });
});
