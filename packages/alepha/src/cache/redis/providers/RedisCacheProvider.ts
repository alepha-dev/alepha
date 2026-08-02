import { $atom, $inject, $store, Alepha, type Infer, z } from "alepha";
import { CacheProvider } from "alepha/cache";
import { $logger } from "alepha/logger";
import { RedisProvider } from "alepha/redis";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis cache configuration atom.
 */
export const redisCacheOptions = $atom({
  name: "alepha.cache.redis.options",
  schema: z.object({
    prefix: z
      .text({
        description:
          "Prefix for all cache keys in Redis. Useful for testing or multi-tenant applications.",
      })
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

export type RedisCacheOptions = Infer<typeof redisCacheOptions.schema>;

declare module "alepha" {
  interface State {
    [redisCacheOptions.key]: RedisCacheOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class RedisCacheProvider extends CacheProvider {
  protected readonly log = $logger();
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly options = $store(redisCacheOptions);
  protected readonly alepha = $inject(Alepha);

  public async get(name: string, key: string): Promise<Uint8Array | undefined> {
    if (!this.alepha.isStarted()) {
      return;
    }

    const keyWithPrefix = this.prefix(name, key);
    const buffer = await this.redisProvider.get(keyWithPrefix);
    if (!buffer) {
      return;
    }

    this.log.debug(`Cache hit`, {
      size: buffer.byteLength,
      key: keyWithPrefix,
    });

    return new Uint8Array(buffer);
  }

  public async set(
    name: string,
    key: string,
    value: Uint8Array | string,
    ttl?: number,
  ): Promise<Uint8Array> {
    if (!this.alepha.isReady()) {
      return new Uint8Array(Buffer.from(value));
    }

    const buffer = Buffer.from(value);
    const prefix = this.prefix(name, key);

    if (ttl) {
      return new Uint8Array(
        await this.redisProvider.set(prefix, buffer, {
          expiration: { type: "PX", value: ttl },
        }),
      );
    }

    return new Uint8Array(await this.redisProvider.set(prefix, buffer));
  }

  public async del(name: string, ...keys: string[]): Promise<void> {
    const nameKey = this.prefix(name);

    if (keys.length === 0) {
      const matched = await this.redisProvider.keys(`${nameKey}:*`);
      if (matched.length > 0) {
        await this.redisProvider.del(matched);
      }
      return;
    }

    const prefixed = keys.map((key) =>
      key.startsWith(nameKey) ? key : this.prefix(name, key),
    );
    if (prefixed.length > 0) {
      await this.redisProvider.del(prefixed);
    }
  }

  public async has(name: string, key: string): Promise<boolean> {
    return this.redisProvider.has(this.prefix(name, key));
  }

  public async keys(name: string, filter?: string): Promise<string[]> {
    if (filter) {
      return await this.redisProvider.keys(`${this.prefix(name)}:${filter}*`);
    }
    return this.redisProvider.keys(`${this.prefix(name)}:*`);
  }

  public async clear(): Promise<void> {
    this.log.debug("Clearing all cache");
    const pattern = `${this.prefix()}:*`;
    const keys = await this.redisProvider.keys(pattern);
    if (keys.length > 0) {
      await this.redisProvider.del(keys);
    }
  }

  public async incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    const keyWithPrefix = this.prefix(name, key);
    return this.redisProvider.incr(keyWithPrefix, amount, ttl);
  }

  protected prefix(...path: string[]): string {
    const parts = ["cache", ...path];

    if (this.options.prefix) {
      parts.unshift(this.options.prefix);
    }

    return parts.join(":");
  }
}
