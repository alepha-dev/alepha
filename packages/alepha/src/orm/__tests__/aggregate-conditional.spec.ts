import { Alepha, AlephaError, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const tickets = $entity({
  name: "test_aggregate_conditional_tickets",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    queue: z.text(),
    amount: z.integer(),
    acceptedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
  }),
});

class App {
  repository = $repository(tickets);
}

const AT = "2026-01-02T03:04:05.000Z";

/**
 * One row per queue, seeded so every bucket below has a different answer -
 * an aggregate that quietly counts everything still looks right against a
 * fixture where the buckets happen to coincide.
 */
const seed = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await app.repository.deleteMany({});
  await app.repository.createMany([
    { queue: "a", amount: 10 },
    { queue: "a", amount: 20, acceptedAt: AT },
    { queue: "a", amount: 30, acceptedAt: AT, completedAt: AT },
    { queue: "b", amount: 40, acceptedAt: AT, completedAt: AT },
  ]);
  return app;
};

/**
 * The shape the whole feature exists for: several differently-conditioned
 * counts over the SAME column, which the column-keyed form cannot express
 * because a column may carry only one count.
 */
const testConditionalBuckets = async (alepha: Alepha) => {
  const app = await seed(alepha);

  const rows = await app.repository.aggregate({
    select: {
      queue: true,
      id: { count: true },
      completed: {
        count: { column: "id", where: { completedAt: { isNotNull: true } } },
      },
      inProgress: {
        count: {
          column: "id",
          where: {
            acceptedAt: { isNotNull: true },
            completedAt: { isNull: true },
          },
        },
      },
      untouched: {
        count: { column: "id", where: { acceptedAt: { isNull: true } } },
      },
    },
    groupBy: ["queue"],
    orderBy: { column: "queue", direction: "asc" },
  });

  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    queue: "a",
    id: { count: 3 },
    completed: { count: 1 },
    inProgress: { count: 1 },
    untouched: { count: 1 },
  });
  expect(rows[1]).toMatchObject({
    queue: "b",
    id: { count: 1 },
    completed: { count: 1 },
    inProgress: { count: 0 },
    untouched: { count: 0 },
  });
};

/**
 * A bucket that matches nothing is `0`, not `null` and not absent - the same
 * side of the empty-set answer the unconditioned `count` already lands on.
 */
const testEmptyBucketIsZero = async (alepha: Alepha) => {
  const app = await seed(alepha);

  const [row] = await app.repository.aggregate({
    select: {
      never: { count: { column: "id", where: { amount: { gt: 10_000 } } } },
      total: { count: { column: "id" } },
      biggest: { max: { column: "amount", where: { queue: { eq: "a" } } } },
      smallestOfNothing: {
        min: { column: "amount", where: { amount: { gt: 10_000 } } },
      },
    },
  });

  expect(row.never.count).toBe(0);
  expect(row.total.count).toBe(4);
  // `column` without `where` is just a renamed plain aggregate, and `min`
  // over an empty bucket keeps SQL's own answer rather than being coerced.
  expect(row.biggest.max).toBe(30);
  expect(row.smallestOfNothing.min).toBeNull();
};

/**
 * The one that must never regress: the per-aggregate condition NARROWS the
 * rows the statement's own WHERE admitted. It cannot widen them.
 */
const testConditionNeverEscapesTheWhere = async (alepha: Alepha) => {
  const app = await seed(alepha);

  const [row] = await app.repository.aggregate({
    select: {
      inScope: { count: { column: "id" } },
      // Names rows the outer WHERE excludes. If the condition replaced or
      // short-circuited that clause this would count them anyway, which on a
      // tenant-scoped or soft-deleted table is the leak.
      elsewhere: { count: { column: "id", where: { queue: { eq: "b" } } } },
    },
    where: { queue: { eq: "a" } },
  });

  expect(row.inScope.count).toBe(3);
  expect(row.elsewhere.count).toBe(0);
};

/**
 * HAVING has to filter on the SAME expression the select computed, or it
 * compares against a different number than the one it returns.
 */
const testHavingOnAConditionedAlias = async (alepha: Alepha) => {
  const app = await seed(alepha);

  const rows = await app.repository.aggregate({
    select: {
      queue: true,
      open: {
        count: { column: "id", where: { completedAt: { isNull: true } } },
      },
    },
    groupBy: ["queue"],
    having: { open: { count: { gt: 0 } } },
  });

  // Queue "b" has one ticket and it is completed, so its `open` is 0 and the
  // group drops. A HAVING built from the key instead of the spec would have
  // compared `COUNT(id)` - 1 for "b" - and kept it.
  expect(rows).toHaveLength(1);
  expect(rows[0].queue).toBe("a");
  expect(rows[0].open.count).toBe(2);
};

/**
 * A key is either a column or an alias, and both mistakes are refused rather
 * than guessed at.
 */
const testKeyRules = async (alepha: Alepha) => {
  const app = await seed(alepha);

  // A misspelt column with no `column` beside it.
  await expect(
    app.repository.aggregate({
      select: { amont: { count: true } } as never,
    }),
  ).rejects.toThrow(AlephaError);

  // An alias spelled like a real column would shadow it in the result.
  await expect(
    app.repository.aggregate({
      select: { amount: { count: { column: "id" } } },
    }),
  ).rejects.toThrow(AlephaError);

  // The separator the flat row is re-nested on.
  await expect(
    app.repository.aggregate({
      select: { open___count: { count: { column: "id" } } },
    }),
  ).rejects.toThrow(AlephaError);
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

describe("aggregate conditional buckets", () => {
  it("counts several differently-conditioned buckets in one pass (sqlite)", async () => {
    await testConditionalBuckets(sqlite());
  });

  it("counts several differently-conditioned buckets in one pass (postgres)", async () => {
    await testConditionalBuckets(postgres());
  });

  it("reports an empty bucket as zero (sqlite)", async () => {
    await testEmptyBucketIsZero(sqlite());
  });

  it("reports an empty bucket as zero (postgres)", async () => {
    await testEmptyBucketIsZero(postgres());
  });

  it("never counts a row the WHERE excluded (sqlite)", async () => {
    await testConditionNeverEscapesTheWhere(sqlite());
  });

  it("never counts a row the WHERE excluded (postgres)", async () => {
    await testConditionNeverEscapesTheWhere(postgres());
  });

  it("filters on the conditioned expression in HAVING (sqlite)", async () => {
    await testHavingOnAConditionedAlias(sqlite());
  });

  it("filters on the conditioned expression in HAVING (postgres)", async () => {
    await testHavingOnAConditionedAlias(postgres());
  });

  it("refuses a key that is neither a clean column nor a clean alias (sqlite)", async () => {
    await testKeyRules(sqlite());
  });

  it("refuses a key that is neither a clean column nor a clean alias (postgres)", async () => {
    await testKeyRules(postgres());
  });
});
