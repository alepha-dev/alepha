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
   * **Pass `signal` whenever the caller has one.** A run that SUPERSEDES
   * another aborts it and then arrives here: without the signal this handed
   * it back the very promise it had just cancelled, so a handler that honours
   * cancellation rejected once for both runs and the query settled with no
   * data at all. Joining is only right while the pending request can still
   * deliver.
   *
   * Not stored in the atom: promises are not serializable, and this state is
   * meaningless outside the current tick.
   */
  public async dedupe<T>(
    key: unknown[],
    fn: () => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const serialized = this.serialize(key);
    const pending = this.inflight.get(serialized);

    if (pending && !pending.signal?.aborted) {
      return pending.promise as Promise<T>;
    }

    const entry: InflightRequest = {
      signal: options.signal,
      promise: undefined as never,
    };

    // Identity-checked, because this entry may already have been replaced by
    // a superseding run: an unconditional delete would evict the newer
    // request and let the run after that fire a duplicate.
    entry.promise = fn().finally(() => {
      if (this.inflight.get(serialized) === entry) {
        this.inflight.delete(serialized);
      }
    });

    this.inflight.set(serialized, entry);
    return entry.promise as Promise<T>;
  }

  protected readonly inflight = new Map<string, InflightRequest>();

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

/**
 * One in-flight request, with the signal of the run that owns it.
 *
 * @see QueryCache.dedupe
 */
interface InflightRequest {
  promise: Promise<unknown>;
  signal?: AbortSignal;
}
