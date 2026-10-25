import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const items = $entity({
  name: "test_offset_items",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    n: z.integer(),
  }),
});

class App {
  repository = $repository(items);
}

const testOffsetWithoutLimit = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.createMany(
    Array.from({ length: 1200 }, (_, n) => ({ n })),
  );

  // Offset with no limit must return everything past the offset — not a
  // silent 1000-row truncation — and must not mutate the caller's query.
  const query = { offset: 100, orderBy: { column: "n" as const } };
  const rows = await app.repository.findMany(query);

  expect(rows).toHaveLength(1100);
  expect((query as { limit?: number }).limit).toBeUndefined();
};

describe("findMany offset without limit", () => {
  it("returns all remaining rows (sqlite)", async () => {
    await testOffsetWithoutLimit(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("returns all remaining rows (postgres)", async () => {
    await testOffsetWithoutLimit(Alepha.create().with(AlephaOrmPostgres));
  });
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `aggregate()` builds its own statement and had no counterpart of the guard
 * above, so the same query that findMany accepts threw on SQLite.
 */
const testAggregateOffsetWithoutLimit = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.createMany(
    Array.from({ length: 5 }, (_, n) => ({ n: n % 3 })),
  );

  const rows = await app.repository.aggregate({
    select: { n: true, id: { count: true } },
    groupBy: ["n"],
    orderBy: { column: "n", direction: "asc" },
    offset: 1,
  });

  expect(rows.map((r) => r.n)).toEqual([1, 2]);
};

describe("aggregate offset without limit", () => {
  it("returns the remaining groups (sqlite)", async () => {
    await testAggregateOffsetWithoutLimit(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("returns the remaining groups (postgres)", async () => {
    await testAggregateOffsetWithoutLimit(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });
});
