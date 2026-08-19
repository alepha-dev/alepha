import {
  $atom,
  $inject,
  $store,
  AlephaError,
  createPrimitive,
  type Infer,
  KIND,
  type MiddlewareMetadata,
  OPTIONS,
  Primitive,
  type Service,
  z,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * Creates a cache primitive for caching with automatic management.
 *
 * **Middleware mode** (no `handler`) - usable in `use` arrays AND as a store:
 * ```ts
 * class UserService {
 *   userCache = $cache({ name: "users", ttl: [10, "minutes"] });
 *
 *   fetchUser = $pipeline({
 *     use: [this.userCache],
 *     handler: async (userId: string) => this.repo.getById(userId),
 *   });
 *
 *   async invalidateUser(userId: string) {
 *     await this.userCache.invalidate(userId);
 *   }
 * }
 * ```
 *
 * **Primitive mode** (with `handler`) - standalone callable:
 * ```ts
 * getUserData = $cache({
 *   name: "user-data",
 *   ttl: [10, "minutes"],
 *   handler: async (userId: string) => {
 *     return await database.users.findById(userId);
 *   }
 * });
 * ```
 */
export function $cache<TReturn = string, TParameter extends any[] = any[]>(
  options: CachePrimitiveOptions<TReturn, TParameter> & {
    handler: (...args: TParameter) => TReturn;
  },
): CachePrimitiveFn<TReturn, TParameter>;
export function $cache<TReturn = any, TParameter extends any[] = any[]>(
  options?: CachePrimitiveOptions<TReturn, TParameter>,
): CacheMiddlewareFn<TReturn>;
export function $cache(options: any = {}): any {
  const instance = createPrimitive(CachePrimitive, options);

  if (options.handler) {
    const fn = (...args: any[]): Promise<any> => instance.run(...args);
    return Object.setPrototypeOf(fn, instance);
  }

  // Middleware mode: callable as (handler) => wrappedHandler, with store methods
  const mw: any = <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => {
      const key = instance.key(...args);
      const read = await instance.read(key);

      if (read.value !== undefined) {
        if (read.stale) {
          instance.scheduleRefresh(key, () => handler(...args));
        }
        return read.value;
      }

      const result = await instance.runSingleFlight(key, () =>
        handler(...args),
      );
      // Fire-and-forget — cache write failures must not break the handler
      // result. `persist` logs, so an outage is visible rather than silent.
      void instance.persist(key, result);
      return result;
    }) as any as T;
  };

  mw[OPTIONS] = {
    name: "$cache",
    options: options as unknown as Record<string, unknown>,
  } satisfies MiddlewareMetadata;

  return Object.setPrototypeOf(mw, instance);
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options for the in-memory L1 tier.
 */
export interface CacheMemoryTierOptions {
  /**
   * TTL for the in-memory tier. Should be ≤ the remote `ttl`.
   * Bounds the cross-isolate staleness window after invalidation.
   *
   * @default min(ttl, 30s)
   */
  ttl?: DurationLike;

  /**
   * LRU bound — max entries kept in memory before eviction.
   *
   * @default 500
   */
  max?: number;

  /**
   * Also cache provider misses (`undefined`) in memory for this duration.
   * Prevents hammering the remote tier on cold/unknown keys.
   *
   * @default off
   */
  negative?: DurationLike;
}

export interface CachePrimitiveOptions<
  TReturn = any,
  TParameter extends any[] = any[],
> {
  /**
   * The cache name. This is useful for invalidating multiple caches at once.
   *
   * Store key as `cache:$name:$key`.
   *
   * @default Name of the key of the class.
   */
  name?: string;

  /**
   * Function which returns cached data.
   */
  handler?: (...args: TParameter) => TReturn;

  /**
   * The key generator for the cache.
   * If not provided, the arguments will be json.stringify().
   */
  key?: (...args: TParameter) => string;

  /**
   * The store provider for the cache.
   *
   * Accepts:
   * - `"memory"` — short-circuits to {@link MemoryCacheProvider} regardless
   *   of the default `CacheProvider` binding. Useful for caches that must
   *   stay process-local (e.g. ETag, HTTP client).
   * - A {@link CacheProvider} class (concrete OR abstract) — resolved via
   *   `alepha.inject(...)` at primitive construction. Use this to opt a
   *   specific cache into a non-default backend (e.g.
   *   `provider: DatabaseCacheProvider` to keep one cache in SQL while the
   *   rest of the app uses Cloudflare KV).
   * - `undefined` — falls back to whatever is bound to `CacheProvider` in
   *   the container. On Cloudflare workers this is
   *   {@link CloudflareKVProvider} by default; on Node it's
   *   {@link MemoryCacheProvider}.
   *
   * Note: passing an *abstract* class works because Alepha's DI resolves
   * through substitutions, e.g. `alepha.with({ provide: CacheProvider, use:
   * MyCacheProvider })`.
   */
  provider?: Service<CacheProvider> | "memory";

  /**
   * The time-to-live for the cache, as a `DurationLike` (e.g. `[10, "minutes"]`).
   * Set 0 to skip expiration.
   *
   * @default 300 seconds (5 minutes).
   */
  ttl?: DurationLike;

  /**
   * If the cache is disabled.
   */
  disabled?: boolean;

  /**
   * Enable gzip compression for cached values.
   * Reduces storage size by 60-80% for JSON payloads at the cost of CPU.
   */
  compress?: boolean;

  /**
   * Add an in-process L1 memory tier in front of `provider`.
   *
   * Reads check memory first, fall back to the provider on miss. Writes go
   * to both tiers (write-through), so own-writes are immediately visible.
   *
   * Caveats:
   * - Per-process only. Each Worker isolate / Node process has its own L1.
   *   `invalidate()` clears the local L1 + the remote provider; other
   *   processes keep their L1 until its TTL expires.
   * - Use a short L1 TTL to bound the cross-isolate staleness window.
   *
   * @default off
   */
  memory?: true | CacheMemoryTierOptions;

  /**
   * Stale-while-revalidate window. After `ttl` expires, the cached value
   * remains servable for `stale` longer; reads in this window return the
   * stale value immediately and trigger ONE background refresh
   * (single-flight per key).
   *
   * Requires a `handler` (primitive mode) OR middleware mode wrapping a
   * handler — the cache needs to know how to recompute.
   *
   * @default off
   */
  stale?: DurationLike;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cache configuration atom.
 */
export const cacheOptions = $atom({
  name: "alepha.cache.options",
  schema: z.object({
    enabled: z.boolean().describe("Whether caching is enabled.").default(true),
    defaultTtl: z
      .number()
      .describe("Default time to live for cache entries in seconds.")
      .default(300),
  }),
  default: {
    enabled: true,
    defaultTtl: 300,
  },
  serverOnly: true,
});

export type CacheAtomOptions = Infer<typeof cacheOptions.schema>;

declare module "alepha" {
  interface State {
    [cacheOptions.key]: CacheAtomOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const DEFAULT_MEMORY_MAX = 500;
const DEFAULT_MEMORY_TTL_MS = 30_000;
// Deliberately distinctive so plausible user data can never be mistaken for
// (and unwrapped as) the SWR envelope.
const SWR_MARKER = "__alepha_swr_envelope__" as const;

type SwrEnvelope = {
  [SWR_MARKER]: 1;
  v: unknown;
  f: number;
  /**
   * Set when `v` is a base64-encoded Uint8Array — the envelope is
   * JSON-serialized, which would otherwise mangle raw bytes into a plain
   * object.
   */
  b?: 1;
};

type L1Entry<T> = {
  value: T | undefined;
  expiresAt: number;
  negative: boolean;
};

type ReadResult<T> = {
  value: T | undefined;
  stale: boolean;
};

export class CachePrimitive<
  TReturn = any,
  TParameter extends any[] = any[],
> extends Primitive<CachePrimitiveOptions<TReturn, TParameter>> {
  protected readonly settings = $store(cacheOptions);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  public readonly provider = this.$provider();

  protected readonly memoryStore?: Map<string, L1Entry<TReturn>>;
  protected readonly memoryMax: number = DEFAULT_MEMORY_MAX;
  protected readonly memoryTtlMs: number = 0;
  protected readonly negativeTtlMs: number = 0;

  protected readonly inflightRefreshes = new Map<string, Promise<TReturn>>();

  constructor(
    args: ConstructorParameters<
      typeof Primitive<CachePrimitiveOptions<TReturn, TParameter>>
    >[0],
  ) {
    super(args);
    const mem = this.options.memory;
    if (mem) {
      this.memoryStore = new Map();
      const memOpts: CacheMemoryTierOptions = mem === true ? {} : mem;
      this.memoryMax = memOpts.max ?? DEFAULT_MEMORY_MAX;
      // Default L1 TTL: min(remote ttl, 30s). If remote ttl is 0/infinite, use 30s.
      if (memOpts.ttl !== undefined) {
        this.memoryTtlMs = this.dateTimeProvider
          .duration(memOpts.ttl)
          .as("milliseconds");
      } else {
        const remoteTtlMs = this.options.ttl
          ? this.dateTimeProvider.duration(this.options.ttl).as("milliseconds")
          : 0;
        this.memoryTtlMs =
          remoteTtlMs > 0
            ? Math.min(remoteTtlMs, DEFAULT_MEMORY_TTL_MS)
            : DEFAULT_MEMORY_TTL_MS;
      }
      if (memOpts.negative !== undefined) {
        this.negativeTtlMs = this.dateTimeProvider
          .duration(memOpts.negative)
          .as("milliseconds");
      }
    }
  }

  public get container(): string {
    return (
      this.options.name ??
      `${this.config.service.name}:${this.config.propertyKey}`
    );
  }

  public async run(...args: TParameter): Promise<TReturn> {
    const handler = this.options.handler;
    if (!handler) {
      throw new AlephaError("Cache handler is not defined.");
    }

    const key = this.key(...args);
    const read = await this.read(key);

    if (read.value !== undefined) {
      if (read.stale) {
        this.scheduleRefresh(key, () => handler(...args));
      }
      return read.value;
    }

    const result = await this.runSingleFlight(key, () => handler(...args));
    // note: when exception occurs, don't cache the result.
    //
    // Awaited (unlike the middleware path) so the entry is durable before the
    // caller sees the value — but through `persist`, so a provider outage
    // cannot fail a request whose answer has already been computed. This used
    // to be a bare `await this.set(...)`: a Redis blip turned a successful
    // handler into a 500, and the two modes failed differently for no reason.
    await this.persist(key, result);
    return result;
  }

  /**
   * Write to the cache, treating failure as non-fatal.
   *
   * A cache is an optimisation: a write that fails costs a future cache miss,
   * never the current result. Both the middleware and the primitive path go
   * through here so they degrade identically — the difference between them is
   * only whether the caller waits for the write.
   */
  public async persist(key: string, value: TReturn): Promise<void> {
    try {
      await this.set(key, value);
    } catch (error) {
      this.log.warn("Cache write failed; returning the uncached result", {
        key,
        container: this.container,
        error,
      });
    }
  }

  public key(...args: TParameter): string {
    return this.options.key ? this.options.key(...args) : JSON.stringify(args);
  }

  public async incr(key: string, amount = 1): Promise<number> {
    // Same gate as read()/set(): a disabled cache must not mutate the store,
    // and on Cloudflare KV an early call throws before the binding exists.
    // Returning the amount keeps the "as if it were the first increment"
    // shape callers already handle from a cold cache.
    if (
      !this.alepha.isStarted() ||
      this.options.disabled ||
      !this.settings.enabled
    ) {
      return amount;
    }

    const ttl = this.options.ttl
      ? this.dateTimeProvider.duration(this.options.ttl).as("milliseconds")
      : undefined;
    const result = await this.provider.incr(
      this.container,
      key,
      amount,
      ttl && ttl > 0 ? ttl : undefined,
    );
    // L1 is no longer authoritative after atomic incr on remote.
    this.delL1(key);
    return result;
  }

  public async invalidate(...keys: string[]): Promise<void> {
    if (this.memoryStore) {
      if (keys.length === 0) {
        this.memoryStore.clear();
      } else {
        for (const key of keys) {
          if (key.endsWith("*")) {
            const prefix = key.slice(0, -1);
            for (const k of this.memoryStore.keys()) {
              if (k.startsWith(prefix)) this.memoryStore.delete(k);
            }
          } else {
            this.memoryStore.delete(key);
          }
        }
      }
    }
    await this.provider.invalidateKeys(this.container, keys);
  }

  public async set(
    key: string,
    value: TReturn,
    ttl?: DurationLike,
  ): Promise<void> {
    if (
      !this.alepha.isStarted() ||
      this.options.disabled ||
      !this.settings.enabled ||
      // `undefined` is the miss sentinel: storing it would serialize to an
      // empty payload that throws on every subsequent read of the key.
      value === undefined
    ) {
      return;
    }

    const freshTtlMs = this.dateTimeProvider
      .duration(
        ttl ?? this.options.ttl ?? [this.settings.defaultTtl, "seconds"],
      )
      .as("milliseconds");

    const staleMs = this.options.stale
      ? this.dateTimeProvider.duration(this.options.stale).as("milliseconds")
      : 0;

    const providerTtlMs = freshTtlMs > 0 ? freshTtlMs + staleMs : 0;
    const now = this.dateTimeProvider.nowMillis();
    const freshUntil = freshTtlMs > 0 ? now + freshTtlMs : 0;

    const payload =
      this.options.stale && freshTtlMs > 0
        ? value instanceof Uint8Array
          ? ({
              [SWR_MARKER]: 1,
              v: Buffer.from(value).toString("base64"),
              f: freshUntil,
              b: 1,
            } satisfies SwrEnvelope)
          : ({ [SWR_MARKER]: 1, v: value, f: freshUntil } satisfies SwrEnvelope)
        : value;

    await this.provider.setTyped(this.container, key, payload, {
      ttl: providerTtlMs > 0 ? providerTtlMs : undefined,
      compress: this.options.compress,
    });

    // Write-through to L1 (raw value, not wrapped).
    this.setL1(key, {
      value,
      expiresAt:
        this.memoryTtlMs > 0
          ? now + this.memoryTtlMs
          : Number.POSITIVE_INFINITY,
      negative: false,
    });

    // A fresh write supersedes any pending refresh for this key.
    this.inflightRefreshes.delete(key);

    await this.alepha.events.emit("cache:set", {
      container: this.container,
      key,
      ttlMs: providerTtlMs > 0 ? providerTtlMs : undefined,
    });
  }

  public async get(key: string): Promise<TReturn | undefined> {
    const read = await this.read(key);
    return read.value;
  }

  /**
   * Internal read that also reports whether the value is stale (SWR
   * grace window). Middleware and `run()` use this to decide whether to
   * schedule a background refresh.
   */
  public async read(key: string): Promise<ReadResult<TReturn>> {
    if (
      !this.alepha.isStarted() ||
      this.options.disabled ||
      !this.settings.enabled
    ) {
      return { value: undefined, stale: false };
    }

    const now = this.dateTimeProvider.nowMillis();

    // L1 check
    if (this.memoryStore) {
      const entry = this.memoryStore.get(key);
      if (entry !== undefined) {
        if (entry.expiresAt > now) {
          // LRU touch
          this.memoryStore.delete(key);
          this.memoryStore.set(key, entry);
          await this.alepha.events.emit("cache:hit", {
            container: this.container,
            key,
          });
          return {
            value: entry.negative ? undefined : entry.value,
            stale: false,
          };
        }
        this.memoryStore.delete(key);
      }
    }

    // L2 check
    const raw = await this.provider.getTyped<TReturn | SwrEnvelope>(
      this.container,
      key,
    );

    if (raw === undefined) {
      // Negative caching
      if (this.memoryStore && this.negativeTtlMs > 0) {
        this.setL1(key, {
          value: undefined,
          expiresAt: now + this.negativeTtlMs,
          negative: true,
        });
      }
      await this.alepha.events.emit("cache:miss", {
        container: this.container,
        key,
      });
      return { value: undefined, stale: false };
    }

    let value: TReturn;
    let stale = false;

    if (this.isSwrEnvelope(raw)) {
      value = (
        raw.b === 1
          ? new Uint8Array(Buffer.from(raw.v as string, "base64"))
          : raw.v
      ) as TReturn;
      stale = raw.f > 0 && raw.f <= now;
    } else {
      value = raw as TReturn;
    }

    // Populate L1 (write-back from L2 read)
    if (this.memoryStore && this.memoryTtlMs > 0) {
      this.setL1(key, {
        value,
        expiresAt: now + this.memoryTtlMs,
        negative: false,
      });
    }

    await this.alepha.events.emit(stale ? "cache:stale" : "cache:hit", {
      container: this.container,
      key,
    });

    return { value, stale };
  }

  /**
   * Run a handler under single-flight: concurrent callers for the same
   * key share one in-flight promise.
   */
  public async runSingleFlight(
    key: string,
    handler: () => Promise<TReturn> | TReturn,
  ): Promise<TReturn> {
    const existing = this.inflightRefreshes.get(key);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        return await handler();
      } finally {
        this.inflightRefreshes.delete(key);
      }
    })();
    this.inflightRefreshes.set(key, promise);
    return promise;
  }

  /**
   * Schedule a background refresh for a stale key. At most one refresh
   * per key is in-flight at any time; failures are swallowed (the stale
   * value keeps being served until expiry).
   */
  public scheduleRefresh(
    key: string,
    handler: () => Promise<TReturn> | TReturn,
  ): void {
    if (this.inflightRefreshes.has(key)) {
      return;
    }
    const promise = (async () => {
      try {
        const result = await handler();
        await this.set(key, result);
        await this.alepha.events.emit("cache:revalidate", {
          container: this.container,
          key,
        });
        return result;
      } finally {
        this.inflightRefreshes.delete(key);
      }
    })();
    promise.catch(() => {
      // swallow: stale value keeps serving until expiry
    });
    this.inflightRefreshes.set(key, promise);
  }

  protected $provider(): CacheProvider {
    if (!this.options.provider) {
      return this.alepha.inject(CacheProvider);
    }

    if (this.options.provider === "memory") {
      return this.alepha.inject(MemoryCacheProvider);
    }

    return this.alepha.inject(this.options.provider);
  }

  protected isSwrEnvelope(value: unknown): value is SwrEnvelope {
    return (
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>)[SWR_MARKER] === 1 &&
      "f" in (value as Record<string, unknown>) &&
      "v" in (value as Record<string, unknown>)
    );
  }

  protected setL1(key: string, entry: L1Entry<TReturn>): void {
    if (!this.memoryStore) return;
    if (this.memoryStore.has(key)) {
      this.memoryStore.delete(key);
    }
    this.memoryStore.set(key, entry);
    while (this.memoryStore.size > this.memoryMax) {
      const first = this.memoryStore.keys().next().value;
      if (first === undefined) break;
      this.memoryStore.delete(first);
    }
  }

  protected delL1(key: string): void {
    this.memoryStore?.delete(key);
  }
}

export interface CachePrimitiveFn<
  TReturn = any,
  TParameter extends any[] = any[],
> extends CachePrimitive<TReturn, TParameter> {
  /**
   * Run the cache primitive with the provided arguments.
   */
  (...args: TParameter): Promise<TReturn>;
}

/**
 * Cache middleware + store. Callable as middleware `(handler) => wrappedHandler`
 * AND exposes store methods (`.get()`, `.set()`, `.invalidate()`, `.incr()`).
 */
export interface CacheMiddlewareFn<TReturn = any>
  extends CachePrimitive<TReturn, any[]> {
  <T extends (...args: any[]) => any>(handler: T): T;
  [OPTIONS]?: MiddlewareMetadata;
}

$cache[KIND] = CachePrimitive;
