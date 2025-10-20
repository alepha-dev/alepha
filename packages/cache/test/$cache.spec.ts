import { randomUUID } from "node:crypto";
import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { describe, expect, it } from "vitest";
import { $cache, MemoryCacheProvider } from "../src";
import {
  TestCache,
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
} from "./shared.ts";

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
    const app = Alepha.create({ env: { REDIS_CACHE_PREFIX: randomUUID() } });
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
});
