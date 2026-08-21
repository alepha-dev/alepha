import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { queryCacheAtom } from "../atoms/queryCacheAtom.ts";

/**
 * Keyed cache behind `useQuery`, with prefix invalidation.
 *
 * Keys are arrays — `["folios", campaignId]` — and invalidation matches by
 * prefix, so `invalidate(["folios"])` drops every folio query regardless of
 * its trailing arguments. That is the shape mutations actually need: a write
 * knows which entity it touched, but rarely every query that observed it.
 */
export class QueryCache {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Stable string form of a key array.
   *
   * Object members are serialized with their properties sorted, so
   * `{ page: 1, size: 10 }` and `{ size: 10, page: 1 }` collide as intended —
   * callers build these inline and property order is not meaningful to them.
   */
  public serialize(key: unknown[]): string {
    return JSON.stringify(key, (_, value) => {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        );
      }
      return value;
    });
  }

  public get(key: unknown[]): QueryCacheEntry | undefined {
    return this.entries()[this.serialize(key)];
  }

  public set(key: unknown[], data: unknown): void {
    this.alepha.store.set(queryCacheAtom, {
      ...this.entries(),
      [this.serialize(key)]: { data, updatedAt: this.dateTime.nowMillis() },
    });
  }

  /**
   * Drop every entry whose key starts with `key`.
   *
   * Matching is done on the serialized prefix minus its closing bracket, so
   * `["folios"]` matches `["folios", 1]` but not `["folios-archive"]` — a
   * plain `startsWith` on the raw string would catch the sibling too.
   */
  public invalidate(key: unknown[]): void {
    const serialized = this.serialize(key);
    const prefix = serialized.slice(0, -1);
    const next: Record<string, QueryCacheEntry> = {};

    for (const [candidate, entry] of Object.entries(this.entries())) {
      const matches =
        candidate === serialized || candidate.startsWith(`${prefix},`);
      if (!matches) {
        next[candidate] = entry;
      }
    }

    this.alepha.store.set(queryCacheAtom, next);
  }

  public clear(): void {
    this.alepha.store.set(queryCacheAtom, {});
    this.inflight.clear();
  }

  /**
   * Run `fn` unless an identical key is already in flight, in which case join
   * the existing request.
   *
   * Without this, two components mounting on the same key in the same tick
   * both miss the cache — it is only populated when the first one resolves —
   * and fire duplicate requests. Deduplication has to happen on the promise,
   * not the cached value.
   *
   * Not stored in the atom: promises are not serializable, and this state is
   * meaningless outside the current tick.
   */
  public async dedupe<T>(key: unknown[], fn: () => Promise<T>): Promise<T> {
    const serialized = this.serialize(key);
    const pending = this.inflight.get(serialized);

    if (pending) {
      return pending as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inflight.delete(serialized);
    });

    this.inflight.set(serialized, promise);
    return promise;
  }

  protected readonly inflight = new Map<string, Promise<unknown>>();

  protected entries(): Record<string, QueryCacheEntry> {
    return this.alepha.store.get(queryCacheAtom) ?? {};
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface QueryCacheEntry {
  /**
   * The last successful result stored under this key.
   */
  data: unknown;

  /**
   * When it was stored, in epoch milliseconds — the basis for `staleTime`.
   */
  updatedAt: number;
}
