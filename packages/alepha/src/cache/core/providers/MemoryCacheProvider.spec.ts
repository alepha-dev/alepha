import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCacheProvider } from "./MemoryCacheProvider.ts";

describe("MemoryCacheProvider", () => {
  let alepha: Alepha;
  let cache: MemoryCacheProvider;
  let time: DateTimeProvider;

  const encode = (value: string) => new TextEncoder().encode(value);

  beforeEach(async () => {
    alepha = Alepha.create();
    cache = alepha.inject(MemoryCacheProvider);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
  });

  describe("get/set", () => {
    it("should store and retrieve values", async () => {
      const data = encode("hello");
      await cache.set("ns", "key1", data);

      const result = await cache.get("ns", "key1");
      expect(result).toEqual(data);
    });

    it("should return undefined for missing key", async () => {
      const result = await cache.get("ns", "missing");
      expect(result).toBeUndefined();
    });

    it("should overwrite existing values", async () => {
      await cache.set("ns", "key", encode("first"));
      await cache.set("ns", "key", encode("second"));

      const result = await cache.get("ns", "key");
      expect(new TextDecoder().decode(result)).toBe("second");
    });

    it("should isolate cache names", async () => {
      await cache.set("a", "key", encode("A"));
      await cache.set("b", "key", encode("B"));

      expect(new TextDecoder().decode(await cache.get("a", "key"))).toBe("A");
      expect(new TextDecoder().decode(await cache.get("b", "key"))).toBe("B");
    });
  });

  describe("TTL", () => {
    it("should expire entries after TTL", async () => {
      await cache.set("ns", "key", encode("value"), 5000);

      expect(await cache.get("ns", "key")).toBeDefined();

      await time.travel([6, "seconds"]);

      expect(await cache.get("ns", "key")).toBeUndefined();
    });

    it("should not expire entries without TTL", async () => {
      await cache.set("ns", "key", encode("value"));

      await time.travel([1, "day"]);

      expect(await cache.get("ns", "key")).toBeDefined();
    });

    it("should reset TTL when overwriting", async () => {
      await cache.set("ns", "key", encode("v1"), 3000);
      await cache.set("ns", "key", encode("v2"), 10000);

      await time.travel([5, "seconds"]);

      // should still be alive (second TTL of 10s)
      expect(new TextDecoder().decode(await cache.get("ns", "key"))).toBe("v2");
    });
  });

  describe("del", () => {
    it("should delete specific keys", async () => {
      await cache.set("ns", "a", encode("1"));
      await cache.set("ns", "b", encode("2"));
      await cache.set("ns", "c", encode("3"));

      await cache.del("ns", "a", "b");

      expect(await cache.get("ns", "a")).toBeUndefined();
      expect(await cache.get("ns", "b")).toBeUndefined();
      expect(await cache.get("ns", "c")).toBeDefined();
    });

    it("should delete all keys for a name when no keys specified", async () => {
      await cache.set("ns", "a", encode("1"));
      await cache.set("ns", "b", encode("2"));

      await cache.del("ns");

      expect(await cache.get("ns", "a")).toBeUndefined();
      expect(await cache.get("ns", "b")).toBeUndefined();
    });

    it("should clean up name when last key is deleted", async () => {
      await cache.set("ns", "only", encode("val"));
      await cache.del("ns", "only");

      expect(cache.names()).not.toContain("ns");
    });
  });

  describe("has", () => {
    it("should return true for existing keys", async () => {
      await cache.set("ns", "key", encode("val"));
      expect(await cache.has("ns", "key")).toBe(true);
    });

    it("should return false for missing keys", async () => {
      expect(await cache.has("ns", "missing")).toBe(false);
    });
  });

  describe("keys", () => {
    it("should return all keys for a name", async () => {
      await cache.set("ns", "a", encode("1"));
      await cache.set("ns", "b", encode("2"));
      await cache.set("ns", "c", encode("3"));

      const keys = await cache.keys("ns");
      expect(keys).toEqual(["a", "b", "c"]);
    });

    it("should filter keys by prefix", async () => {
      await cache.set("ns", "user:1", encode("a"));
      await cache.set("ns", "user:2", encode("b"));
      await cache.set("ns", "post:1", encode("c"));

      const keys = await cache.keys("ns", "user:");
      expect(keys).toEqual(["user:1", "user:2"]);
    });

    it("should return empty array for missing name", async () => {
      expect(await cache.keys("missing")).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      await cache.set("a", "k1", encode("v1"));
      await cache.set("b", "k2", encode("v2"));

      await cache.clear();

      expect(await cache.get("a", "k1")).toBeUndefined();
      expect(await cache.get("b", "k2")).toBeUndefined();
      expect(cache.names()).toEqual([]);
    });
  });

  describe("incr", () => {
    it("should start from zero", async () => {
      const val = await cache.incr("ns", "counter", 1);
      expect(val).toBe(1);
    });

    it("should increment existing value", async () => {
      await cache.incr("ns", "counter", 1);
      const val = await cache.incr("ns", "counter", 5);
      expect(val).toBe(6);
    });

    it("should handle negative amounts", async () => {
      await cache.incr("ns", "counter", 10);
      const val = await cache.incr("ns", "counter", -3);
      expect(val).toBe(7);
    });
  });

  describe("stats", () => {
    it("should track hits and misses", async () => {
      await cache.set("ns", "key", encode("val"));

      await cache.get("ns", "key"); // hit
      await cache.get("ns", "key"); // hit
      await cache.get("ns", "miss"); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("should track sets and deletes", async () => {
      await cache.set("ns", "a", encode("1"));
      await cache.set("ns", "b", encode("2"));
      await cache.del("ns", "a");

      const stats = cache.stats();
      expect(stats.sets).toBe(2);
      expect(stats.deletes).toBe(1);
    });
  });

  describe("test utilities", () => {
    it("wasSet should check by name and key", async () => {
      await cache.set("ns", "key", encode("val"));

      expect(cache.wasSet("ns")).toBe(true);
      expect(cache.wasSet("ns", "key")).toBe(true);
      expect(cache.wasSet("ns", "other")).toBe(false);
      expect(cache.wasSet("other")).toBe(false);
    });

    it("wasGet should check by name and key", async () => {
      await cache.set("ns", "key", encode("val"));
      await cache.get("ns", "key");

      expect(cache.wasGet("ns")).toBe(true);
      expect(cache.wasGet("ns", "key")).toBe(true);
      expect(cache.wasGet("ns", "other")).toBe(false);
    });

    it("wasDeleted should check by name and key", async () => {
      await cache.set("ns", "key", encode("val"));
      await cache.del("ns", "key");

      expect(cache.wasDeleted("ns")).toBe(true);
      expect(cache.wasDeleted("ns", "key")).toBe(true);
      expect(cache.wasDeleted("ns", "other")).toBe(false);
    });

    it("size should count entries", async () => {
      await cache.set("a", "k1", encode("v"));
      await cache.set("a", "k2", encode("v"));
      await cache.set("b", "k3", encode("v"));

      expect(cache.size("a")).toBe(2);
      expect(cache.size("b")).toBe(1);
      expect(cache.size()).toBe(3);
    });

    it("names should list cache names", async () => {
      await cache.set("alpha", "k", encode("v"));
      await cache.set("beta", "k", encode("v"));

      expect(cache.names()).toEqual(["alpha", "beta"]);
    });
  });

  describe("reset", () => {
    it("should clear all state", async () => {
      await cache.set("ns", "key", encode("val"));
      await cache.get("ns", "key");
      await cache.del("ns", "key");

      cache.reset();

      expect(cache.size()).toBe(0);
      expect(cache.getCalls).toHaveLength(0);
      expect(cache.setCalls).toHaveLength(0);
      expect(cache.delCalls).toHaveLength(0);
      expect(cache.stats()).toEqual({
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
      });
    });
  });

  describe("error injection", () => {
    it("should throw getError when set", async () => {
      cache.getError = new Error("get failed");
      await expect(cache.get("ns", "key")).rejects.toThrow("get failed");
    });

    it("should throw setError when set", async () => {
      cache.setError = new Error("set failed");
      await expect(cache.set("ns", "key", encode("val"))).rejects.toThrow(
        "set failed",
      );
    });

    it("should throw delError when set", async () => {
      cache.delError = new Error("del failed");
      await expect(cache.del("ns", "key")).rejects.toThrow("del failed");
    });
  });
});
