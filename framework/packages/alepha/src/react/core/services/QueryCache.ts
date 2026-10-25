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
    const matches = (candidate: string) =>
      candidate === serialized || candidate.startsWith(`${prefix},`);
    const next: Record<string, QueryCacheEntry> = {};

    for (const [candidate, entry] of Object.entries(this.entries())) {
      if (!matches(candidate)) {
        next[candidate] = entry;
      }
    }

    // A read still in flight was issued before the write that invalidates it.
    // Its generation moves on, so its response never reaches the cache, and
    // its entry leaves the in-flight map, so a reader mounting now starts a
    // fresh request instead of joining the stale one. The stale request is
    // not aborted: its callers still get their answer.
    for (const candidate of this.generations.keys()) {
      if (matches(candidate)) {
        this.generations.set(
          candidate,
          (this.generations.get(candidate) ?? 0) + 1,
        );
      }
    }
    for (const candidate of this.inflight.keys()) {
      if (matches(candidate)) {
        this.inflight.delete(candidate);
      }
    }

    this.alepha.store.set(queryCacheAtom, next);
  }

  public clear(): void {
    this.alepha.store.set(queryCacheAtom, {});
    this.inflight.clear();
    for (const [candidate, generation] of this.generations) {
      this.generations.set(candidate, generation + 1);
    }
  }

  /**
   * The invalidation generation of `key`, bumped by every `invalidate()` or
   * `clear()` that covers it.
   *
   * A reader takes it before fetching and compares after: a different value
   * means the response predates a write, so it is returned to its caller but
   * never stored. See `useQuery`.
   */
  public generation(key: unknown[]): number {
    const serialized = this.serialize(key);
    const current = this.generations.get(serialized);
    if (current === undefined) {
      this.generations.set(serialized, 0);
      return 0;
    }
    return current;
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
   * **The shared request owns its own `AbortController`**, handed to `fn`.
   * Each caller subscribes with its own `signal`, and the request is aborted
   * only once every subscriber has aborted. It used to carry the FIRST
   * caller's signal: when that component unmounted, a second one joined to
   * the same promise received its `AbortError` and settled with no data.
   *
   * **Pass `signal` whenever the caller has one.** A caller that aborts gets
   * its own `AbortError` at once, whatever the request does. A run that
   * SUPERSEDES another aborts it and then arrives here: when it was the only
   * subscriber, the request is aborted and this run starts a new one, rather
   * than being handed the promise it had just cancelled. A caller without a
   * signal can never unsubscribe, so it keeps the request alive.
   *
   * Not stored in the atom: promises are not serializable, and this state is
   * meaningless outside the current tick.
   */
  public async dedupe<T>(
    key: unknown[],
    fn: (signal: AbortSignal) => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const serialized = this.serialize(key);
    const pending = this.inflight.get(serialized);

    if (pending && !pending.controller.signal.aborted) {
      return this.subscribe(pending, options.signal) as Promise<T>;
    }

    const entry: InflightRequest = {
      controller: new AbortController(),
      subscribers: 0,
      promise: undefined as never,
    };

    // Identity-checked, because this entry may already have been replaced by
    // a superseding run or dropped by an invalidation: an unconditional
    // delete would evict the newer request and let the run after that fire a
    // duplicate.
    entry.promise = fn(entry.controller.signal).finally(() => {
      if (this.inflight.get(serialized) === entry) {
        this.inflight.delete(serialized);
      }
    });
    // Each subscriber observes the shared promise through its own wrapper;
    // this one only keeps a rejection nobody waits for from going unhandled.
    entry.promise.catch(() => {});

    this.inflight.set(serialized, entry);
    return this.subscribe(entry, options.signal) as Promise<T>;
  }

  protected readonly inflight = new Map<string, InflightRequest>();

  protected readonly generations = new Map<string, number>();

  /**
   * Join `entry` as one more subscriber. The returned promise settles with
   * the shared request, or rejects with an `AbortError` as soon as `signal`
   * aborts; the last subscriber to abort aborts the request itself.
   */
  protected subscribe(
    entry: InflightRequest,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    entry.subscribers += 1;
    if (!signal) {
      return entry.promise;
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.subscribers -= 1;
        if (entry.subscribers === 0) {
          entry.controller.abort(signal.reason);
        }
        reject(
          signal.reason instanceof Error && signal.reason.name === "AbortError"
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

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
 * One in-flight request: its own abort controller, and how many callers
 * still wait on it.
 *
 * @see QueryCache.dedupe
 */
interface InflightRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  subscribers: number;
}
