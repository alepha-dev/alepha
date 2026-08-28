import { randomUUID } from "node:crypto";

import type { Alepha } from "alepha";
import { describe, it } from "vitest";

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
  testCacheContainerIsolation,
  testCacheKeyContract,
  testCacheProviderClear,
  testCacheReturnTypes,
  testCacheSetDisabled,
  testCacheStop,
  testSimpleKeyMappingHandler,
} from "../../core/__tests__/shared.ts";
import { RedisCacheProvider, redisCacheOptions } from "../index.ts";

const provider = RedisCacheProvider;
const configure = () => (app: Alepha) => {
  app.store.mut(redisCacheOptions, () => ({ prefix: randomUUID() }));
};

describe("$cache - redis", () => {
  it("should handle basic caching", async () => {
    await testCacheBasic(configure(), provider);
  });

  it("should handle stop lifecycle", async () => {
    await testCacheStop(configure(), provider);
  });

  it("should handle missing provider", async () => {
    await testCacheMissingProvider(configure(), provider);
  });

  it("should handle disabled cache", async () => {
    await testCacheDisabled(configure(), provider);
  });

  it("should invalidate by key", async () => {
    await testCacheInvalidateByKey(configure(), provider);
  });

  it("should invalidate by args", async () => {
    await testCacheInvalidateByArgs(configure(), provider);
  });

  it("should invalidate all entries", async () => {
    await testCacheInvalidateAll(configure(), provider);
  });

  it("should clear cache", async () => {
    await testCacheClear(configure(), provider);
  });

  it("should handle different return types", async () => {
    await testCacheReturnTypes(configure(), provider);
  });

  it("should generate cache keys correctly", async () => {
    await testCacheKeys(configure(), provider);
  });

  it("should handle unique key with args", async () => {
    await testSimpleKeyMappingHandler();
  });

  it("should clear provider cache", async () => {
    await testCacheProviderClear(configure(), provider);
  });

  it("should keep containers whose names differ only by a colon apart", async () => {
    await testCacheContainerIsolation(configure(), provider);
  });

  it("should return and accept caller-side keys", async () => {
    await testCacheKeyContract(configure(), provider);
  });

  it("should increment values atomically", async () => {
    await testCacheIncr(configure(), provider);
  });

  it("should read back incremented counters via getTyped", async () => {
    await testCacheIncrThenGet(configure(), provider);
  });

  it("should expire incremented counters after their ttl", async () => {
    await testCacheIncrTtl(configure(), provider);
  });

  it("should cache falsy values (0, empty string, false, null)", async () => {
    await testCacheFalsyValues(configure(), provider);
  });

  it("should not write to provider when cache is disabled", async () => {
    await testCacheSetDisabled(configure(), provider);
  });

  it("should increment via primitive", async () => {
    await testCachePrimitiveIncr(configure(), provider);
  });

  it("should compress cached values with gzip", async () => {
    await testCacheCompress(configure(), provider);
  });

  it("should handle different types with compression", async () => {
    await testCacheCompressTypes(configure(), provider);
  });
});
