import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import type { CachePrimitive } from "../primitives/$cache.ts";
import { CacheProvider } from "./CacheProvider.ts";
import { CloudflareKVProvider } from "./CloudflareKVProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The name the database cache plugin registers its provider under.
 *
 * ⚠️ **A string, and it has to be.** `alepha/cache/database` imports
 * `alepha/cache`, which under workerd IS this barrel, so naming the class
 * here would be a two-module cycle the build's analyser rejects. The
 * container's own by-name lookup is the seam that carries the reference
 * without the import, and it is the idiom `BuildManifestTask` already uses
 * for `RepositoryProvider` and `JobQueueProvider`.
 *
 * It is therefore a rename hazard with nothing in the type system holding it:
 * `CloudflareCacheProvider.spec.ts` asserts the real class answers to it.
 */
const DATABASE_CACHE_PROVIDER = "DatabaseCacheProvider";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare cache provider: the database cache when the app has one, else KV.
 *
 * This is the `CacheProvider` a Cloudflare Worker gets by default.
 *
 * ## Why the default moved off KV
 *
 * For an app with a database, KV was the wrong default on every axis
 * (feedback #Q2151, folio #F1273). Reads are $0.50 per million keys against
 * $0.001 per million rows on D1, a 500x difference; writes are $5.00 against
 * $1.00; KV is eventually consistent where D1 is strongly consistent; KV
 * clamps every TTL to a 60 second floor.
 *
 * And KV is the only one of the four providers that cannot implement `incr`
 * atomically. `CloudflareKVProvider.incr` documents that against itself:
 * two isolates incrementing concurrently can lose an update, which is not
 * sufficient for a rate limiter that must never over-admit. That is why five
 * `$cache` call sites across `api/users` and `api/oauth` used to pin
 * `provider: DatabaseCacheProvider` by hand; this class is what let those
 * hardcodes go.
 *
 * The latency argument for KV does not survive either: D1 has read
 * replication, `CloudflareD1Provider.openSession()` implements it, Cloudflare
 * creates the replicas at no cost, and `DATABASE_D1_MODE=sessions` turns it
 * on. A config flag, not an architecture.
 *
 * ## Why a delegator rather than a branch at registration time
 *
 * Two simpler mechanisms were tried on paper first and both fail:
 *
 * - **Branch `AlephaCache`'s `register()` on `DATABASE_URL`.** It cannot name
 *   `DatabaseCacheProvider` (the cycle above), and `DATABASE_URL` is the
 *   wrong question anyway: an app can set it and register no ORM.
 * - **Let `alepha/cache/database` bind `CacheProvider` itself.** ⚠️ This one
 *   looks right and is silently order-dependent. A substitution is recorded
 *   only `if (!this.has(entry.provide))`, so the FIRST binding wins and every
 *   later `optional: true` one is dropped without a word. `AlephaCache` is
 *   registered as a plain service by `alepha/server/etag`, which
 *   `alepha/server/swagger` pulls in, so KV would usually be bound long
 *   before anything reached the database module.
 *
 * Resolving at `start` sidesteps the ordering entirely: by then every module
 * has registered and the question has one answer.
 *
 * ## The signal is the module, not the environment
 *
 * "This container has a `DatabaseCacheProvider`" is narrower and more honest
 * than "`DATABASE_URL` is set". It is true exactly when something registered
 * `alepha/cache/database`, which is what puts `cache_entries` in the
 * migration snapshot - so the provider this picks can never be one whose
 * table does not exist.
 *
 * ⚠️ **Resolved once, at `start`.** A cache read must not pay a container
 * lookup, and the container is locked by then, so the answer cannot change
 * underneath it.
 */
export class CloudflareCacheProvider extends CacheProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly kv = $inject(CloudflareKVProvider);
  protected readonly log = $logger();

  /**
   * What this forwards to. Assigned at `start` and never reassigned.
   */
  protected target: CacheProvider = this.kv;

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      const database = this.resolveDatabaseCache();
      if (database) {
        this.target = database;
        this.log.info("Cloudflare cache is the database cache");
        return;
      }

      // ⚠️ The same guard `CloudflareKVProvider`'s own hook applies, and it
      // has to be repeated here rather than left to it: that hook counts
      // primitives whose provider is the KV instance, and every primitive
      // now points at THIS one. Without it, registering `alepha/cache` in an
      // app that declares no `$cache` at all would demand a KV binding.
      const used = this.alepha
        .primitives<CachePrimitive>("cache")
        .some((it) => it.provider === this);
      if (!used) {
        this.log.info(
          "CloudflareCacheProvider is registered but no cache primitives are using it. Skipping KV initialization.",
        );
        return;
      }

      this.kv.connect();
      this.log.info("Cloudflare cache is KV: this app has no database cache");
    },
  });

  public get(name: string, key: string): Promise<Uint8Array | undefined> {
    return this.target.get(name, key);
  }

  public set(
    name: string,
    key: string,
    value: Uint8Array,
    ttl?: number,
  ): Promise<Uint8Array> {
    return this.target.set(name, key, value, ttl);
  }

  public del(name: string, ...keys: string[]): Promise<void> {
    return this.target.del(name, ...keys);
  }

  public has(name: string, key: string): Promise<boolean> {
    return this.target.has(name, key);
  }

  public keys(name: string, filter?: string): Promise<string[]> {
    return this.target.keys(name, filter);
  }

  public clear(): Promise<void> {
    return this.target.clear();
  }

  public incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    return this.target.incr(name, key, amount, ttl);
  }

  /**
   * ⚠️ The three concrete helpers are forwarded too, rather than inherited.
   *
   * `CacheProvider` implements them on top of the abstract seven, so
   * inheriting them would work today and would silently stop honouring an
   * override the day a backend adds one - a backend that serializes its own
   * values, say. Forwarding costs three lines and cannot go stale.
   */
  public setTyped(
    name: string,
    key: string,
    value: unknown,
    options?: { ttl?: number; compress?: boolean },
  ): Promise<void> {
    return this.target.setTyped(name, key, value, options);
  }

  public getTyped<T>(name: string, key: string): Promise<T | undefined> {
    return this.target.getTyped<T>(name, key);
  }

  public invalidateKeys(name: string, keys: string[]): Promise<void> {
    return this.target.invalidateKeys(name, keys);
  }

  /**
   * The database cache provider, if this container has one.
   *
   * `inject()` by name throws when nothing answers to it, which is the
   * ordinary "this app has no database cache" case rather than a fault, so
   * the throw is swallowed. The `instanceof` is not belt and braces: the
   * lookup walks the registry by class NAME, so an unrelated class that
   * happens to be called `DatabaseCacheProvider` would otherwise be returned
   * and used as a cache.
   */
  protected resolveDatabaseCache(): CacheProvider | undefined {
    try {
      const found = this.alepha.inject(DATABASE_CACHE_PROVIDER);
      return found instanceof CacheProvider ? found : undefined;
    } catch {
      return undefined;
    }
  }
}
