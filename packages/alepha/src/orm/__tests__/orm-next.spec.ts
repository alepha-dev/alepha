import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testAggregateBasic,
  testAggregateHaving,
  testAggregateMinMaxCount,
  testAggregateOrderByDotNotation,
  testExistsSubquery,
  testGeneratedColumnExcludedFromInsertSchema,
  testGeneratedColumnPostgres,
  testGeneratedColumnSqlite,
  testPartialCompositeIndex,
  testPartialIndex,
  testQueryCache,
  testQueryCacheCustomKey,
} from "./orm-next-tests.ts";

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

// =============================================================================
// Feature 1: Partial Indexes
// =============================================================================

describe("partial indexes", () => {
  it("should support partial unique index (sqlite)", async () => {
    await testPartialIndex(sqlite());
  });
  it("should support partial unique index (postgres)", async () => {
    await testPartialIndex(postgres());
  });
  it("should support partial composite index (sqlite)", async () => {
    await testPartialCompositeIndex(sqlite());
  });
  it("should support partial composite index (postgres)", async () => {
    await testPartialCompositeIndex(postgres());
  });
});

// =============================================================================
// Feature 2: Subqueries (exists / notExists)
// =============================================================================

describe("subqueries", () => {
  it("should support exists and notExists (sqlite)", async () => {
    await testExistsSubquery(sqlite());
  });
  it("should support exists and notExists (postgres)", async () => {
    await testExistsSubquery(postgres());
  });
});

// =============================================================================
// Feature 4: Aggregate Functions
// =============================================================================

describe("aggregates", () => {
  it("should compute sum and avg grouped by column (sqlite)", async () => {
    await testAggregateBasic(sqlite());
  });
  it("should compute sum and avg grouped by column (postgres)", async () => {
    await testAggregateBasic(postgres());
  });
  it("should compute min, max, and count (sqlite)", async () => {
    await testAggregateMinMaxCount(sqlite());
  });
  it("should compute min, max, and count (postgres)", async () => {
    await testAggregateMinMaxCount(postgres());
  });
  it("should filter groups with having clause (sqlite)", async () => {
    await testAggregateHaving(sqlite());
  });
  it("should filter groups with having clause (postgres)", async () => {
    await testAggregateHaving(postgres());
  });
  it("should order by aggregate with dot notation (sqlite)", async () => {
    await testAggregateOrderByDotNotation(sqlite());
  });
  it("should order by aggregate with dot notation (postgres)", async () => {
    await testAggregateOrderByDotNotation(postgres());
  });
});

// =============================================================================
// Feature 6: Generated Columns
// =============================================================================

describe("generated columns", () => {
  it("should compute virtual generated column (sqlite)", async () => {
    await testGeneratedColumnSqlite(sqlite());
  });
  it("should compute stored generated column (postgres)", async () => {
    await testGeneratedColumnPostgres(postgres());
  });
  it("should exclude generated columns from insert and update schemas", async () => {
    await testGeneratedColumnExcludedFromInsertSchema(sqlite());
  });
});

// =============================================================================
// Feature 7: Query Caching
// =============================================================================

describe("query caching", () => {
  it("should cache and invalidate on write (sqlite)", async () => {
    await testQueryCache(sqlite());
  });
  it("should cache and invalidate on write (postgres)", async () => {
    await testQueryCache(postgres());
  });
  it("should support custom cache keys (sqlite)", async () => {
    await testQueryCacheCustomKey(sqlite());
  });
  it("should support custom cache keys (postgres)", async () => {
    await testQueryCacheCustomKey(postgres());
  });
});
