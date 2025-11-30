import {
  $env,
  $inject,
  createPrimitive,
  type InstantiableClass,
  KIND,
  Primitive,
  t,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { CacheError } from "../errors/CacheError.ts";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * Creates a cache primitive for high-performance data caching with automatic management.
 *
 * Provides a caching layer that improves application performance by storing frequently accessed
 * data in memory or external stores like Redis, with support for both function result caching
 * and manual cache operations.
 *
 * **Key Features**
 * - Automatic function result caching based on input parameters
 * - Multiple storage backends (in-memory, Redis, custom providers)
 * - Intelligent serialization for JSON, strings, and binary data
 * - Configurable TTL with automatic expiration
 * - Pattern-based cache invalidation with wildcard support
 * - Environment controls to enable/disable caching
 *
 * **Storage Backends**
 * - Memory: Fast in-memory cache (default for development)
 * - Redis: Distributed cache for production environments
 * - Custom providers: Implement your own storage backend
 *
 * @example
 * ```ts
 * class DataService {
 *   // Function result caching
 *   getUserData = $cache({
 *     name: "user-data",
 *     ttl: [10, "minutes"],
 *     handler: async (userId: string) => {
 *       return await database.users.findById(userId);
 *     }
 *   });
 *
 *   // Manual cache operations
 *   sessionCache = $cache<UserSession>({
 *     name: "sessions",
 *     ttl: [1, "hour"]
 *   });
 *
 *   async storeSession(id: string, session: UserSession) {
 *     await this.sessionCache.set(id, session);
 *   }
 *
 *   async invalidateUserSessions(userId: string) {
 *     await this.sessionCache.invalidate(`user:${userId}:*`);
 *   }
 * }
 * ```
 */
export const $cache = <TReturn = string, TParameter extends any[] = any[]>(
  options: CachePrimitiveOptions<TReturn, TParameter> = {},
): CachePrimitiveFn<TReturn, TParameter> => {
  const instance = createPrimitive(
    CachePrimitive<TReturn, TParameter>,
    options,
  );
  const fn = (...args: TParameter): Promise<TReturn> => instance.run(...args);
  return Object.setPrototypeOf(fn, instance) as CachePrimitiveFn<
    TReturn,
    TParameter
  >;
};

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
}

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  CACHE_ENABLED: t.boolean({ default: true }),
  CACHE_DEFAULT_TTL: t.number({
    default: 300, // 5 minutes
    description: "The default time to live for cache entries. In seconds.",
  }),
});

export class CachePrimitive<
  TReturn = any,
  TParameter extends any[] = any[],
> extends Primitive<CachePrimitiveOptions<TReturn, TParameter>> {
  protected readonly env = $env(envSchema);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly provider = this.$provider();
  protected encoder: TextEncoder = new TextEncoder();
  protected decoder: TextDecoder = new TextDecoder();
  protected codes = {
    BINARY: 0x01,
    JSON: 0x02,
    STRING: 0x03,
  };

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
    if (cached) {
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

  public async invalidate(...keys: string[]): Promise<void> {
    const keysToDelete: string[] = [];

    for (const key of keys) {
      if (key.endsWith("*")) {
        const result = await this.provider.keys(
          this.container,
          key.slice(0, -1),
        );
        keysToDelete.push(...result);
      } else {
        keysToDelete.push(key);
      }
    }

    await this.provider.del(this.container, ...keysToDelete);
  }

  public async set(
    key: string,
    value: TReturn,
    ttl?: DurationLike,
  ): Promise<void> {
    const px = this.dateTimeProvider
      .duration(
        ttl ?? this.options.ttl ?? [this.env.CACHE_DEFAULT_TTL, "seconds"],
      )
      .as("milliseconds");

    await this.provider.set(
      this.container,
      key,
      this.serialize(value),
      px > 0 ? px : undefined,
    );
  }

  public async get(key: string): Promise<TReturn | undefined> {
    if (
      !this.alepha.isStarted() ||
      this.options.disabled ||
      !this.env.CACHE_ENABLED
    ) {
      return undefined;
    }

    const data = await this.provider.get(this.container, key);
    if (data) {
      return await this.deserialize<TReturn>(data);
    }

    return undefined;
  }

  protected serialize<TReturn>(value: TReturn): Uint8Array {
    if (value instanceof Uint8Array) {
      return new Uint8Array([this.codes.BINARY, ...value]); // TODO: check if copy is ok?
    }

    if (typeof value === "string") {
      return new Uint8Array([this.codes.STRING, ...this.encoder.encode(value)]);
    }

    return new Uint8Array([
      this.codes.JSON,
      ...this.encoder.encode(JSON.stringify(value)),
    ]);
  }

  protected async deserialize<TReturn>(
    uint8Array: Uint8Array,
  ): Promise<TReturn> {
    const type = uint8Array[0];
    const payload = uint8Array.slice(1);

    if (type === this.codes.BINARY) {
      return payload as TReturn;
    }
    if (type === this.codes.JSON) {
      return JSON.parse(this.decoder.decode(payload)) as TReturn;
    }
    if (type === this.codes.STRING) {
      return this.decoder.decode(payload) as TReturn;
    }

    throw new CacheError(`Unknown serialization type: ${type}`);
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

$cache[KIND] = CachePrimitive;
