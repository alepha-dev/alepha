import type { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  testCacheBasic,
  testCacheClear,
  testCacheCompress,
  testCacheCompressTypes,
  testCacheDisabled,
  testCacheFalsyValues,
  testCacheIncr,
  testCacheIncrThenGet,
  testCacheIncrTtl,
  testCacheInvalidateAll,
  testCacheInvalidateByArgs,
  testCacheInvalidateByKey,
  testCacheKeys,
  testCacheMissingProvider,
  testCachePrimitiveIncr,
  testCacheProviderClear,
  testCacheReturnTypes,
  testCacheSetDisabled,
  testSimpleKeyMappingHandler,
} from "../../core/__tests__/shared.ts";
import { DatabaseCacheProvider } from "../index.ts";

const provider = DatabaseCacheProvider;

// Override DATABASE_URL via process.env BEFORE Alepha.create() runs in each
// shared test. The shared `testSimpleKeyMappingHandler` instantiates the app
// (and therefore the SQLite provider) inside the .with() chain, BEFORE the
// `configure` callback runs — so we can't rely on `app.store.set("env", ...)`
// to flip the URL fast enough; the env schema has already been parsed and
// cached by the time configure fires.
const sqlite = () => (_app: Alepha) => {};

describe("$cache - database (sqlite)", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "sqlite://:memory:");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should handle basic caching", async () => {
    await testCacheBasic(sqlite(), provider);
  });

  it("should handle missing provider", async () => {
    await testCacheMissingProvider(sqlite(), provider);
  });

  it("should handle disabled cache", async () => {
    await testCacheDisabled(sqlite(), provider);
  });

  it("should invalidate by key", async () => {
    await testCacheInvalidateByKey(sqlite(), provider);
  });

  it("should invalidate by args", async () => {
    await testCacheInvalidateByArgs(sqlite(), provider);
  });

  it("should invalidate all entries", async () => {
    await testCacheInvalidateAll(sqlite(), provider);
  });

  it("should clear cache", async () => {
    await testCacheClear(sqlite(), provider);
  });

  it("should handle different return types", async () => {
    await testCacheReturnTypes(sqlite(), provider);
  });

  it("should generate cache keys correctly", async () => {
    await testCacheKeys(sqlite(), provider);
  });

  it("should handle unique key with args", async () => {
    await testSimpleKeyMappingHandler(sqlite(), provider);
  });

  it("should clear provider cache", async () => {
    await testCacheProviderClear(sqlite(), provider);
  });

  it("should increment values atomically", async () => {
    await testCacheIncr(sqlite(), provider);
  });

  it("should read back incremented counters via getTyped", async () => {
    await testCacheIncrThenGet(sqlite(), provider);
  });

  it("should expire incremented counters after their ttl", async () => {
    await testCacheIncrTtl(sqlite(), provider);
  });

  it("should cache falsy values (0, empty string, false, null)", async () => {
    await testCacheFalsyValues(sqlite(), provider);
  });

  it("should not write to provider when cache is disabled", async () => {
    await testCacheSetDisabled(sqlite(), provider);
  });

  it("should increment via primitive", async () => {
    await testCachePrimitiveIncr(sqlite(), provider);
  });

  it("should compress cached values with gzip", async () => {
    await testCacheCompress(sqlite(), provider);
  });

  it("should handle different types with compression", async () => {
    await testCacheCompressTypes(sqlite(), provider);
  });
});
