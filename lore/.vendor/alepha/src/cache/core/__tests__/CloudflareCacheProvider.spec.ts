import { Alepha } from "alepha";
import {
  AlephaCacheDatabase,
  DatabaseCacheProvider,
} from "alepha/cache/database";
import { AlephaLogger } from "alepha/logger";
import { describe, expect, it } from "vitest";

import { $cache } from "../index.ts";
// ⚠️ The workerd barrel by relative path, on purpose. `alepha/cache` resolves
// to the NODE barrel under vitest, and the node barrel binds
// `MemoryCacheProvider` - so importing the specifier would test a module that
// is not the one this file is about. This is the only way to exercise the
// real Cloudflare registration from a node runner.
import { AlephaCache as AlephaCacheWorkerd } from "../index.workerd.ts";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { CloudflareCacheProvider } from "../providers/CloudflareCacheProvider.ts";
import {
  KV_DEFAULT_BINDING,
  type KVListOptions,
  type KVListResult,
  type KVPutOptions,
} from "../providers/CloudflareKVProvider.ts";

/**
 * Enough of a KV namespace to say whether anything reached it.
 */
class FakeKV {
  public puts: Array<{ key: string; options?: KVPutOptions }> = [];
  protected store = new Map<string, ArrayBuffer | string>();

  async get(key: string, type?: "text" | "arrayBuffer"): Promise<any> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    // oxlint-disable-next-line typescript/no-base-to-string
    return type === "arrayBuffer" ? value : String(value);
  }

  async put(
    key: string,
    value: string | ArrayBuffer,
    options?: KVPutOptions,
  ): Promise<void> {
    this.puts.push({ key, options });
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix ?? "";
    return {
      keys: [...this.store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * The Cloudflare cache default, since #Q2151: the database cache when the
 * container has one, KV when it does not.
 */
describe("CloudflareCacheProvider", () => {
  /**
   * ⚠️ The provider reaches the database cache **by class name**, because
   * importing it would be a two-module cycle. Nothing in the type system
   * holds that string to the class, so this is the only thing standing
   * between a rename and a silent, total fallback to KV - which would look
   * like nothing at all until the next Cloudflare invoice.
   */
  describe("the by-name reference", () => {
    it("names the class alepha/cache/database actually exports", () => {
      expect(DatabaseCacheProvider.name).toBe("DatabaseCacheProvider");
    });
  });

  describe("choosing a target", () => {
    /**
     * The ordering proof, and the reason this is a delegator rather than a
     * binding inside `alepha/cache/database`.
     *
     * A substitution is recorded only `if (!this.has(entry.provide))`, so the
     * FIRST binding of `CacheProvider` wins and every later `optional: true`
     * one is dropped in silence. `AlephaCache` is registered as a plain
     * service by `alepha/server/etag` (which `alepha/server/swagger` pulls
     * in), so in a real app it is usually bound long before anything reaches
     * the database module. Registering it first here is that race, made
     * deterministic.
     */
    it("picks the database cache even when alepha/cache registered first", async () => {
      const alepha = Alepha.create({
        env: { DATABASE_URL: "sqlite://:memory:" },
      })
        .with(AlephaLogger)
        .with(AlephaCacheWorkerd)
        .with(AlephaCacheDatabase);

      await alepha.start();

      const cache = alepha.inject(CacheProvider);
      expect(cache).toBeInstanceOf(CloudflareCacheProvider);

      // Behavioural rather than a peek at the field: a write through the
      // default lands in `cache_entries`, which is only true if the target
      // really is the database provider.
      await cache.set("probe", "k", bytes("v"));
      const stored = await alepha
        .inject(DatabaseCacheProvider)
        .get("probe", "k");

      expect(stored && new TextDecoder().decode(stored)).toBe("v");
    });

    it("falls back to KV when the container has no database cache", async () => {
      const kv = new FakeKV();
      const alepha = Alepha.create()
        .with(AlephaLogger)
        .with(AlephaCacheWorkerd);

      class App {
        cache = $cache({ name: "ambient" });
      }
      alepha.inject(App);
      alepha.store.set("cloudflare.env", { [KV_DEFAULT_BINDING]: kv });
      await alepha.start();

      await alepha.inject(CacheProvider).set("ambient", "k", bytes("v"));

      expect(kv.puts).toHaveLength(1);
    });

    /**
     * ⚠️ The guard `CloudflareKVProvider`'s own `start` hook applies, repeated
     * on the delegator because every primitive now points at the delegator
     * and that hook's filter therefore answers zero. Without it, registering
     * `alepha/cache` in an app that declares no `$cache` would demand a KV
     * binding it has no reason to have.
     */
    it("demands no KV binding when nothing uses the cache", async () => {
      const alepha = Alepha.create()
        .with(AlephaLogger)
        .with(AlephaCacheWorkerd);

      await expect(alepha.start()).resolves.toBeDefined();
    });

    it("still refuses to run a cache on a worker with no KV namespace", async () => {
      // The other half of that guard: a `$cache` that reaches KV with no
      // binding is a deploy that provisioned the wrong resource, and it has
      // to fail at boot rather than on the first read.
      const alepha = Alepha.create()
        .with(AlephaLogger)
        .with(AlephaCacheWorkerd);

      class App {
        cache = $cache({ name: "ambient" });
      }
      alepha.inject(App);

      await expect(alepha.start()).rejects.toThrow(/Cloudflare/);
    });
  });

  describe("forwarding", () => {
    const booted = async () => {
      const alepha = Alepha.create({
        env: { DATABASE_URL: "sqlite://:memory:" },
      })
        .with(AlephaLogger)
        .with(AlephaCacheWorkerd)
        .with(AlephaCacheDatabase);
      await alepha.start();
      return alepha;
    };

    it("round-trips a typed value through the target", async () => {
      const cache = (await booted()).inject(CacheProvider);

      await cache.setTyped("c", "k", { hello: "world" });

      expect(await cache.getTyped("c", "k")).toEqual({ hello: "world" });
    });

    /**
     * The whole point of the new default: KV cannot do this without losing
     * updates, which is why five `$cache` call sites in `api/users` and
     * `api/oauth` pin the database provider by hand.
     */
    it("forwards incr to a target that counts atomically", async () => {
      const cache = (await booted()).inject(CacheProvider);

      expect(await cache.incr("c", "hits", 1)).toBe(1);
      expect(await cache.incr("c", "hits", 2)).toBe(3);
    });

    it("forwards del, has, keys and clear", async () => {
      const cache = (await booted()).inject(CacheProvider);

      await cache.set("c", "a", bytes("1"));
      await cache.set("c", "b", bytes("2"));

      expect(await cache.has("c", "a")).toBe(true);
      expect((await cache.keys("c")).sort()).toEqual(["a", "b"]);

      await cache.del("c", "a");
      expect(await cache.has("c", "a")).toBe(false);

      await cache.clear();
      expect(await cache.has("c", "b")).toBe(false);
    });
  });
});
