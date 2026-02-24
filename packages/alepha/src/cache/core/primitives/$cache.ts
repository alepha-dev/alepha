import {
  $atom,
  $inject,
  $use,
  createPrimitive,
  type InstantiableClass,
  KIND,
  type MiddlewareMetadata,
  OPTIONS,
  Primitive,
  type Static,
  t,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * Creates a cache primitive for caching with automatic management.
 *
 * **Middleware mode** (no `handler`) — usable in `use` arrays AND as a store:
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
 * **Primitive mode** (with `handler`) — standalone callable:
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
      const cached = await instance.get(key);
      if (cached !== undefined) return cached;

      const result = await handler(...args);
      // Fire-and-forget — cache write failures must not break the handler result
      instance.set(key, result).catch(() => {});
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
   * If not provided, the default store provider will be used.
   */
  provider?: InstantiableClass<CacheProvider> | "memory";

  /**
   * The time-to-live for the cache in seconds.
   * Set 0 to skip expiration.
   *
   * @default 300 (5 minutes).
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
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cache configuration atom.
 */
export const cacheOptions = $atom({
  name: "alepha.cache.options",
  schema: t.object({
    enabled: t.boolean({
      default: true,
      description: "Whether caching is enabled.",
    }),
    defaultTtl: t.number({
      default: 300,
      description: "Default time to live for cache entries in seconds.",
    }),
  }),
  default: {
    enabled: true,
    defaultTtl: 300,
  },
});

export type CacheAtomOptions = Static<typeof cacheOptions.schema>;

declare module "alepha" {
  interface State {
    [cacheOptions.key]: CacheAtomOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class CachePrimitive<
  TReturn = any,
  TParameter extends any[] = any[],
> extends Primitive<CachePrimitiveOptions<TReturn, TParameter>> {
  protected readonly settings = $use(cacheOptions);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  public readonly provider = this.$provider();

  public get container(): string {
    return (
      this.options.name ??
      `${this.config.service.name}:${this.config.propertyKey}`
    );
  }

  public async run(...args: TParameter): Promise<TReturn> {
    const handler = this.options.handler;
    if (!handler) {
      throw new Error("Cache handler is not defined.");
    }

    const key = this.key(...args);
    const cached = await this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await handler(...args);
    // note: when exception occurs, don't cache the result

    await this.set(key, result);

    return result;
  }

  public key(...args: TParameter): string {
    return this.options.key ? this.options.key(...args) : JSON.stringify(args);
  }

  public async incr(key: string, amount = 1): Promise<number> {
    return this.provider.incr(this.container, key, amount);
  }

  public async invalidate(...keys: string[]): Promise<void> {
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
      !this.settings.enabled
    ) {
      return;
    }

    const px = this.dateTimeProvider
      .duration(
        ttl ?? this.options.ttl ?? [this.settings.defaultTtl, "seconds"],
      )
      .as("milliseconds");

    await this.provider.setTyped(this.container, key, value, {
      ttl: px > 0 ? px : undefined,
      compress: this.options.compress,
    });
  }

  public async get(key: string): Promise<TReturn | undefined> {
    if (
      !this.alepha.isStarted() ||
      this.options.disabled ||
      !this.settings.enabled
    ) {
      return undefined;
    }

    return this.provider.getTyped<TReturn>(this.container, key);
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
