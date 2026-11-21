import { type Alepha, z } from "alepha";
import { sql } from "drizzle-orm";
import { expect } from "vitest";

import { PG_GENERATED } from "../core/constants/PG_SYMBOLS.ts";
import {
  $entity,
  $repository,
  DatabaseProvider,
  db,
  DbConflictError,
  pgAttr,
} from "../core/index.ts";

// ============================================================================
// Shared entity definitions
// ============================================================================

const orderEntity = $entity({
  name: "orders",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    category: z.text(),
    amount: z.number(),
    status: z.text(),
  }),
});

// ============================================================================
// Partial Indexes
// ============================================================================

export const testPartialIndex = async (alepha: Alepha) => {
  const entity = $entity({
    name: "items_partial_idx",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      email: z.text(),
      active: z.boolean(),
    }),
    indexes: [
      {
        column: "email",
        unique: true,
        where: sql`active = true`,
      },
    ],
  });

  class App {
    repo = $repository(entity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  // Create an active item: unique constraint applies
  const a = await app.repo.create({ email: "alice@test.com", active: true });
  expect(a.email).toBe("alice@test.com");

  // Deactivate it: no longer covered by partial index
  await app.repo.updateById(a.id, { active: false });

  // Insert same email as active: allowed because first one is inactive
  const b = await app.repo.create({ email: "alice@test.com", active: true });
  expect(b.email).toBe("alice@test.com");
  expect(b.id).not.toBe(a.id);

  // A second ACTIVE row with that email is what the index refuses.
  await expect(
    app.repo.create({ email: "alice@test.com", active: true }),
  ).rejects.toThrow(DbConflictError);
};

export const testPartialCompositeIndex = async (alepha: Alepha) => {
  const entity = $entity({
    name: "items_partial_comp_idx",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      category: z.text(),
      name: z.text(),
      active: z.boolean(),
    }),
    indexes: [
      {
        columns: ["category", "name"],
        unique: true,
        where: sql`active = true`,
      },
    ],
  });

  class App {
    repo = $repository(entity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.repo.create({ category: "A", name: "foo", active: true });

  // Same category+name but inactive: allowed by partial index
  await app.repo.create({ category: "A", name: "foo", active: false });

  // A second active row with the same pair is what the index refuses.
  await expect(
    app.repo.create({ category: "A", name: "foo", active: true }),
  ).rejects.toThrow(DbConflictError);

  const all = await app.repo.findMany();
  expect(all).toHaveLength(2);
};

// ============================================================================
// Aggregate Functions
// ============================================================================

export const testAggregateHaving = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.createMany([
    { category: "A", amount: 10, status: "paid" },
    { category: "A", amount: 20, status: "paid" },
    { category: "B", amount: 500, status: "paid" },
    { category: "B", amount: 600, status: "paid" },
  ]);

  // Only groups where sum > 100
  const result = await app.orders.aggregate({
    select: { category: true, amount: { sum: true } },
    groupBy: ["category"],
    having: { amount: { sum: { gt: 100 } } },
  });

  expect(result).toHaveLength(1);
  expect(result[0].category).toBe("B");
  expect(result[0].amount.sum).toBe(1100);
};

export const testAggregateOrderByDotNotation = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.createMany([
    { category: "A", amount: 500, status: "paid" },
    { category: "B", amount: 100, status: "paid" },
    { category: "C", amount: 300, status: "paid" },
  ]);

  const result = await app.orders.aggregate({
    select: { category: true, amount: { sum: true } },
    groupBy: ["category"],
    orderBy: { column: "amount.sum", direction: "desc" },
  });

  expect(result).toHaveLength(3);
  expect(result[0].category).toBe("A");
  expect(result[1].category).toBe("C");
  expect(result[2].category).toBe("B");
};

// ============================================================================
// Generated Columns (SQLite only: virtual)
// ============================================================================

export const testGeneratedColumnSqlite = async (alepha: Alepha) => {
  const entity = $entity({
    name: "generated_col",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      firstName: z.text(),
      lastName: z.text(),
      fullName: pgAttr(z.text(), PG_GENERATED, {
        expression: sql`first_name || ' ' || last_name`,
        mode: "virtual",
      }),
    }),
  });

  class App {
    repo = $repository(entity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  // Insert without fullName: it's computed
  const created = await app.repo.create({
    firstName: "John",
    lastName: "Doe",
  });

  expect(created.fullName).toBe("John Doe");

  // Verify findMany also returns the computed value
  const all = await app.repo.findMany();
  expect(all).toHaveLength(1);
  expect(all[0].fullName).toBe("John Doe");
};

export const testGeneratedColumnPostgres = async (alepha: Alepha) => {
  const entity = $entity({
    name: "generated_col_pg",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      firstName: z.text(),
      lastName: z.text(),
      fullName: pgAttr(z.text(), PG_GENERATED, {
        expression: sql`first_name || ' ' || last_name`,
        mode: "stored",
      }),
    }),
  });

  class App {
    repo = $repository(entity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  const created = await app.repo.create({
    firstName: "Jane",
    lastName: "Smith",
  });

  expect(created.fullName).toBe("Jane Smith");

  const all = await app.repo.findMany();
  expect(all).toHaveLength(1);
  expect(all[0].fullName).toBe("Jane Smith");
};

export const testGeneratedColumnExcludedFromInsertSchema = async (
  alepha: Alepha,
) => {
  const entity = $entity({
    name: "generated_schema_test",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      a: z.text(),
      b: z.text(),
      computed: pgAttr(z.text(), PG_GENERATED, {
        expression: sql`a || b`,
        mode: "virtual",
      }),
    }),
  });

  // Verify insertSchema does not contain generated column
  const insertProps = Object.keys(z.schema.shape(entity.insertSchema));
  expect(insertProps).toContain("a");
  expect(insertProps).toContain("b");
  expect(insertProps).not.toContain("computed");

  // Verify updateSchema does not contain generated column
  const updateProps = Object.keys(z.schema.shape(entity.updateSchema));
  expect(updateProps).toContain("a");
  expect(updateProps).toContain("b");
  expect(updateProps).not.toContain("computed");
};

// ============================================================================
// Query Caching
// ============================================================================

/**
 * A row written behind the repository's back: no cache is invalidated, so a
 * cached read that still answers without it was served from the cache.
 */
const insertBehindTheCache = async (alepha: Alepha, app: { orders: any }) => {
  await alepha
    .inject(DatabaseProvider)
    .execute(
      sql`INSERT INTO ${app.orders.table} (category, amount, status) VALUES ('A', 5, 'paid')`,
    );
};

export const testQueryCache = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();
  const read = (cache?: { ttl: number }) =>
    app.orders.findMany({ where: { category: { eq: "A" } } }, { cache });

  await app.orders.create({ category: "A", amount: 100, status: "paid" });

  // First call: hits the database and fills the cache.
  expect(await read({ ttl: 60_000 })).toHaveLength(1);

  // A hit: the cached answer does not see the row written behind it, while
  // an uncached read does.
  await insertBehindTheCache(alepha, app);
  expect(await read({ ttl: 60_000 })).toHaveLength(1);
  expect(await read()).toHaveLength(2);

  // A repository write invalidates: the next cached read is fresh.
  await app.orders.create({ category: "A", amount: 200, status: "paid" });
  expect(await read({ ttl: 60_000 })).toHaveLength(3);
};

export const testQueryCacheCustomKey = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();
  const read = (key: string) =>
    app.orders.findMany({}, { cache: { ttl: 60_000, key } });

  await app.orders.create({ category: "A", amount: 100, status: "paid" });

  expect(await read("all-orders")).toHaveLength(1);

  // The same key answers from the cache, another key reads the database.
  await insertBehindTheCache(alepha, app);
  expect(await read("all-orders")).toHaveLength(1);
  expect(await read("all-orders-again")).toHaveLength(2);
};
