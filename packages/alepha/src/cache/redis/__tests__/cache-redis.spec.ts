import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import {
  testCacheBasic,
  testCacheClear,
  testCacheDisabled,
  testCacheInvalidateAll,
  testCacheInvalidateByArgs,
  testCacheInvalidateByKey,
  testCacheKeys,
  testCacheMissingProvider,
  testCacheProviderClear,
  testCacheReturnTypes,
  testCacheStop,
  testSimpleKeyMappingHandler,
} from "../../core/__tests__/shared.ts";
import { RedisCacheProvider } from "../index.ts";

const provider = RedisCacheProvider;
const env = () => ({ REDIS_CACHE_PREFIX: randomUUID() });

describe("$cache - redis", () => {
  it("should handle basic caching", async () => {
    await testCacheBasic(env(), provider);
  });

  it("should handle stop lifecycle", async () => {
    await testCacheStop(env(), provider);
  });

  it("should handle missing provider", async () => {
    await testCacheMissingProvider(env(), provider);
  });

  it("should handle disabled cache", async () => {
    await testCacheDisabled(env(), provider);
  });

  it("should invalidate by key", async () => {
    await testCacheInvalidateByKey(env(), provider);
  });

  it("should invalidate by args", async () => {
    await testCacheInvalidateByArgs(env(), provider);
  });

  it("should invalidate all entries", async () => {
    await testCacheInvalidateAll(env(), provider);
  });

  it("should clear cache", async () => {
    await testCacheClear(env(), provider);
  });

  it("should handle different return types", async () => {
    await testCacheReturnTypes(env(), provider);
  });

  it("should generate cache keys correctly", async () => {
    await testCacheKeys(env(), provider);
  });

  it("should handle unique key with args", async () => {
    await testSimpleKeyMappingHandler();
  });

  it("should clear provider cache", async () => {
    await testCacheProviderClear(env(), provider);
  });
});
