import type { CacheProvider } from "@alepha/cache";
import { $env, $inject, Alepha, type Static, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { RedisProvider } from "@alepha/redis";

const envSchema = t.object({
  REDIS_CACHE_PREFIX: t.optional(
    t.text({
      description:
        "Force a prefix for all cache keys in Redis. Useful for testing or multi-tenant applications.",
    }),
  ),
});

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class RedisCacheProvider implements CacheProvider {
  protected readonly log = $logger();
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly env = $env(envSchema);
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
      const keys = await this.redisProvider.keys(`${nameKey}:*`);
      await this.redisProvider.del(keys);
      return;
    }

    await this.redisProvider.del(
      keys.map((key) =>
        key.startsWith(nameKey) ? key : this.prefix(name, key),
      ),
    );
  }

  public async has(name: string, key: string): Promise<boolean> {
    return this.get(name, key).then((value) => value != null);
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
    await this.redisProvider.del(keys);
  }

  protected prefix(...path: string[]): string {
    const parts = ["cache", ...path];

    if (this.env.REDIS_CACHE_PREFIX) {
      parts.unshift(this.env.REDIS_CACHE_PREFIX);
    }

    return parts.join(":");
  }
}
