import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $cache, CacheProvider } from "alepha/cache";
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
  testCachePrimitiveIncrDefaultTtl,
  testCacheContainerIsolation,
  testCacheKeyContract,
  testCacheProviderClear,
  testCacheReturnTypes,
  testCacheSetDisabled,
  testCacheStop,
  testSimpleKeyMappingHandler,
} from "../../core/__tests__/shared.ts";
import { AlephaCacheRedis, RedisCacheProvider } from "../index.ts";

// The shared test env sets no REDIS_URL, so nothing else turns Redis on; this
// file runs against the compose `redis` service (16379, CI's port too). A
// test file runs in its own process, so this reaches no other file.
process.env.REDIS_URL ??= "redis://localhost:16379";

const provider = RedisCacheProvider;
const configure = () => (app: Alepha) => {
  // One namespace per test: the provider keys every entry with alepha.name.
  app.loadEnv({ APP_NAME: randomUUID() });
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

  it("should expire primitive counters through defaultTtl", async () => {
    await testCachePrimitiveIncrDefaultTtl(configure(), provider);
  });

  it("should compress cached values with gzip", async () => {
    await testCacheCompress(configure(), provider);
  });

  it("should handle different types with compression", async () => {
    await testCacheCompressTypes(configure(), provider);
  });
});

describe("RedisCacheProvider: one namespace per alepha.name", () => {
  const boot = async (name: string) => {
    const alepha = Alepha.create({ env: { APP_NAME: name } }).with(
      AlephaCacheRedis,
    );

    class App {
      users = $cache({ name: "users", ttl: [10, "minutes"] });
    }

    alepha.inject(App);
    await alepha.start();
    return alepha.inject(CacheProvider);
  };

  it("never reads another name's entries, and clear() deletes its own namespace only", async ({
    expect,
  }) => {
    const a = await boot(`a-${randomUUID()}`);
    const b = await boot(`b-${randomUUID()}`);
    const other = await boot(`c-${randomUUID()}`);

    await a.set("users", "1", new TextEncoder().encode("a"));
    await b.set("users", "1", new TextEncoder().encode("b"));

    expect(new TextDecoder().decode(await a.get("users", "1"))).toBe("a");
    expect(await other.has("users", "1")).toBe(false);

    await a.clear();

    expect(await a.has("users", "1")).toBe(false);
    expect(await b.has("users", "1")).toBe(true);
  });
});
