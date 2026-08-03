import { type Alepha, z } from "alepha";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { PG_GENERATED } from "../core/constants/PG_SYMBOLS.ts";
import { $entity, $repository, db, pgAttr } from "../core/index.ts";

// ============================================================================
// Shared entity definitions
// ============================================================================

const orderEntity = $entity({
  name: "orders",
  schema: z.object({
    id: db.primaryKey(),
    category: z.text(),
    amount: z.number(),
    status: z.text(),
  }),
});

// ============================================================================
// Feature 1: Partial Indexes
// ============================================================================

export const testPartialIndex = async (alepha: Alepha) => {
  const entity = $entity({
    name: "items_partial_idx",
    schema: z.object({
      id: db.primaryKey(),
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

  // Create an active item — unique constraint applies
  const a = await app.repo.create({ email: "alice@test.com", active: true });
  expect(a.email).toBe("alice@test.com");

  // Deactivate it — no longer covered by partial index
  await app.repo.updateById(a.id, { active: false });

  // Insert same email as active — allowed because first one is inactive
  const b = await app.repo.create({ email: "alice@test.com", active: true });
  expect(b.email).toBe("alice@test.com");
  expect(b.id).not.toBe(a.id);
};

export const testPartialCompositeIndex = async (alepha: Alepha) => {
  const entity = $entity({
    name: "items_partial_comp_idx",
    schema: z.object({
      id: db.primaryKey(),
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

  // Same category+name but inactive — allowed by partial index
  await app.repo.create({ category: "A", name: "foo", active: false });

  const all = await app.repo.findMany();
  expect(all).toHaveLength(2);
};

// ============================================================================
// Feature 2: Subqueries (exists / notExists)
// ============================================================================

export const testExistsSubquery = async (alepha: Alepha) => {
  const parentEntity = $entity({
    name: "parents_exist",
    schema: z.object({
      id: db.primaryKey(),
      name: z.text(),
    }),
  });

  const childEntity = $entity({
    name: "children_exist",
    schema: z.object({
      id: db.primaryKey(),
      parentId: z.integer(),
      label: z.text(),
    }),
  });

  class App {
    parents = $repository(parentEntity);
    children = $repository(childEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  const p1 = await app.parents.create({ name: "P1" });
  const p2 = await app.parents.create({ name: "P2" });
  await app.children.create({ parentId: p1.id, label: "C1" });

  // parents that have at least one child
  const withChildren = await app.parents.findMany({
    where: {
      exists: sql`(SELECT 1 FROM children_exist WHERE children_exist.parent_id = parents_exist.id)`,
    },
  });
  expect(withChildren).toHaveLength(1);
  expect(withChildren[0].name).toBe("P1");

  // parents that have NO children
  const withoutChildren = await app.parents.findMany({
    where: {
      notExists: sql`(SELECT 1 FROM children_exist WHERE children_exist.parent_id = parents_exist.id)`,
    },
  });
  expect(withoutChildren).toHaveLength(1);
  expect(withoutChildren[0].name).toBe("P2");
};

// ============================================================================
// Feature 4: Aggregate Functions
// ============================================================================

export const testAggregateBasic = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.createMany([
    { category: "A", amount: 100, status: "paid" },
    { category: "A", amount: 200, status: "paid" },
    { category: "B", amount: 50, status: "paid" },
    { category: "B", amount: 150, status: "pending" },
  ]);

  // Basic grouped aggregation
  const result = await app.orders.aggregate({
    select: { category: true, amount: { sum: true, avg: true } },
    groupBy: ["category"],
    orderBy: "category",
  });

  expect(result).toHaveLength(2);
  expect(result[0].category).toBe("A");
  expect(result[0].amount.sum).toBe(300);
  expect(result[0].amount.avg).toBe(150);
  expect(result[1].category).toBe("B");
  expect(result[1].amount.sum).toBe(200);
};

export const testAggregateMinMaxCount = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.createMany([
    { category: "X", amount: 10, status: "paid" },
    { category: "X", amount: 30, status: "paid" },
    { category: "X", amount: 50, status: "paid" },
  ]);

  const result = await app.orders.aggregate({
    select: {
      category: true,
      amount: { min: true, max: true, count: true },
    },
    groupBy: ["category"],
  });

  expect(result).toHaveLength(1);
  expect(result[0].amount.min).toBe(10);
  expect(result[0].amount.max).toBe(50);
  expect(result[0].amount.count).toBe(3);
};

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
// Feature 6: Generated Columns (SQLite only — virtual)
// ============================================================================

export const testGeneratedColumnSqlite = async (alepha: Alepha) => {
  const entity = $entity({
    name: "generated_col",
    schema: z.object({
      id: db.primaryKey(),
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

  // Insert without fullName — it's computed
  const created = await app.repo.create({
    firstName: "John",
    lastName: "Doe",
  } as any);

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
      id: db.primaryKey(),
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
  } as any);

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
      id: db.primaryKey(),
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
// Feature 7: Query Caching
// ============================================================================

export const testQueryCache = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.create({ category: "A", amount: 100, status: "paid" });

  // First call — hits DB
  const first = await app.orders.findMany(
    { where: { category: { eq: "A" } } },
    { cache: { ttl: 60_000 } },
  );
  expect(first).toHaveLength(1);

  // Insert another — won't be in cache (cache was invalidated by write)
  await app.orders.create({ category: "A", amount: 200, status: "paid" });

  // This should hit DB again (cache was invalidated by the create above)
  const afterInsert = await app.orders.findMany(
    { where: { category: { eq: "A" } } },
    { cache: { ttl: 60_000 } },
  );
  expect(afterInsert).toHaveLength(2);

  // This should return cached result (no writes since last query)
  const cached = await app.orders.findMany(
    { where: { category: { eq: "A" } } },
    { cache: { ttl: 60_000 } },
  );
  expect(cached).toHaveLength(2);
};

export const testQueryCacheCustomKey = async (alepha: Alepha) => {
  class App {
    orders = $repository(orderEntity);
  }

  const app = alepha.inject(App);
  await alepha.start();

  await app.orders.create({ category: "A", amount: 100, status: "paid" });

  // Use custom cache key
  const result = await app.orders.findMany(
    {},
    { cache: { ttl: 60_000, key: "all-orders" } },
  );
  expect(result).toHaveLength(1);

  // Same custom key returns cached result
  const cached = await app.orders.findMany(
    {},
    { cache: { ttl: 60_000, key: "all-orders" } },
  );
  expect(cached).toHaveLength(1);
};
