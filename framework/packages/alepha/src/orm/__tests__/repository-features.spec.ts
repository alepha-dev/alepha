import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  testAggregateHaving,
  testAggregateOrderByDotNotation,
  testGeneratedColumnExcludedFromInsertSchema,
  testGeneratedColumnPostgres,
  testGeneratedColumnSqlite,
  testPartialCompositeIndex,
  testPartialIndex,
  testQueryCache,
  testQueryCacheCustomKey,
} from "./repository-features-tests.ts";

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmTestPostgres);

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

describe("aggregates", () => {
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
