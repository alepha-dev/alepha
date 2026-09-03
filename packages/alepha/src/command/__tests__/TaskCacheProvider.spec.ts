import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { TaskCacheProvider } from "../providers/TaskCacheProvider.ts";

describe("TaskCacheProvider", () => {
  const createTestEnv = () => {
    const dir = mkdtempSync(join(tmpdir(), "alepha-cache-spec-"));
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "silent", ALEPHA_CACHE_DIR: dir },
    });
    return { dir, cache: alepha.inject(TaskCacheProvider) };
  };

  describe("digest", () => {
    it("should be stable for the same parts", () => {
      const { cache } = createTestEnv();

      expect(cache.digest(["a", "b"])).toBe(cache.digest(["a", "b"]));
    });

    it("should change when any part changes", () => {
      const { cache } = createTestEnv();

      expect(cache.digest(["a", "b"])).not.toBe(cache.digest(["a", "c"]));
    });

    /**
     * Joining parts with a separator that can occur inside a part makes
     * `["a:b", "c"]` and `["a", "b:c"]` the same key, which is a cache hit
     * between two different things.
     */
    it("should not collide when a part contains the separator", () => {
      const { cache } = createTestEnv();

      expect(cache.digest(["a:b", "c"])).not.toBe(cache.digest(["a", "b:c"]));
    });
  });

  describe("isFresh", () => {
    it("should be false for a key never recorded", async () => {
      const { cache } = createTestEnv();

      expect(await cache.isFresh("nope")).toBe(false);
    });

    it("should be true once recorded", async () => {
      const { cache } = createTestEnv();

      await cache.record("abc");

      expect(await cache.isFresh("abc")).toBe(true);
    });

    it("should not confuse two keys", async () => {
      const { cache } = createTestEnv();

      await cache.record("abc");

      expect(await cache.isFresh("abd")).toBe(false);
    });

    /**
     * A key is a hex digest, but the store is a directory and a key becomes a
     * filename. A caller passing something path-shaped must not be able to
     * read or write outside the store.
     */
    it("should not let a key escape the store", async () => {
      const { cache } = createTestEnv();

      await cache.record("../../escaped");

      expect(await cache.isFresh("../../escaped")).toBe(true);
      expect(await cache.isFresh("escaped")).toBe(false);
    });
  });

  describe("forget", () => {
    it("should drop a recorded key", async () => {
      const { cache } = createTestEnv();
      await cache.record("abc");

      await cache.forget("abc");

      expect(await cache.isFresh("abc")).toBe(false);
    });

    it("should not fail on a key that was never recorded", async () => {
      const { cache } = createTestEnv();

      await expect(cache.forget("nope")).resolves.toBeUndefined();
    });
  });
});
