import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import {
  TestCache,
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
  testCacheProviderClear,
  testCacheReturnTypes,
  testCacheSetDisabled,
  testCacheStop,
  testSimpleKeyMappingHandler,
} from "../__tests__/shared.ts";
import { $cache, MemoryCacheProvider } from "../index.ts";

describe("$cache", () => {
  it("should handle basic caching", async () => {
    await testCacheBasic();
  });

  it("should handle stop lifecycle", async () => {
    await testCacheStop();
  });

  it("should handle missing provider", async () => {
    await testCacheMissingProvider();
  });

  it("should handle disabled cache", async () => {
    await testCacheDisabled();
  });

  it("should invalidate by key", async () => {
    await testCacheInvalidateByKey();
  });

  it("should invalidate by args", async () => {
    await testCacheInvalidateByArgs();
  });

  it("should invalidate all entries", async () => {
    await testCacheInvalidateAll();
  });

  it("should clear cache", async () => {
    await testCacheClear();
  });

  it("should handle different return types", async () => {
    await testCacheReturnTypes();
  });

  it("should generate cache keys correctly", async () => {
    await testCacheKeys();
  });

  it("should handle infinite TTL", async () => {
    const app = Alepha.create();
    const test = app.inject(TestCache);
    const time = app.inject(DateTimeProvider);
    await app.start();

    expect(await test.b({ name: "A" })).toBe("A:0");
    expect(await test.b({ name: "A" })).toBe("A:0");
    await time.travel([1, "day"]);
    expect(await test.b({ name: "A" })).toBe("A:0");
  });

  it("should handle unique key without args", async () => {
    let count = 0;
    class A {
      task = $cache({
        handler: () => {
          count++;
          return "DONE";
        },
      });
    }
    const app = Alepha.create();
    const test = app.inject(A);
    await app.start();

    expect(await test.task()).toBe("DONE");
    expect(await test.task()).toBe("DONE");
    expect(await test.task()).toBe("DONE");
    expect(count).toBe(1);

    await test.task.invalidate();
    expect(await test.task()).toBe("DONE");
    expect(await test.task()).toBe("DONE");
    expect(count).toBe(2);

    // [] means no args, it's JSON.stringify([])
    const obj = await app.inject(MemoryCacheProvider).get("A:task", "[]");
    expect(new TextDecoder().decode(obj?.slice(1))).toEqual("DONE");
  });

  it("should handle unique key with args", async () => {
    await testSimpleKeyMappingHandler();
  });

  it("should clear provider cache", async () => {
    await testCacheProviderClear();
  });

  it("should keep containers whose names differ only by a colon apart", async () => {
    await testCacheContainerIsolation();
  });

  it("should increment values atomically", async () => {
    await testCacheIncr();
  });

  it("should read back incremented counters via getTyped", async () => {
    await testCacheIncrThenGet();
  });

  it("should expire incremented counters after their ttl", async () => {
    await testCacheIncrTtl();
  });

  it("should cache falsy values (0, empty string, false, null)", async () => {
    await testCacheFalsyValues();
  });

  it("should not write to provider when cache is disabled", async () => {
    await testCacheSetDisabled();
  });

  it("should increment via primitive", async () => {
    await testCachePrimitiveIncr();
  });

  it("should compress cached values with gzip", async () => {
    await testCacheCompress();
  });

  it("should handle different types with compression", async () => {
    await testCacheCompressTypes();
  });
});
