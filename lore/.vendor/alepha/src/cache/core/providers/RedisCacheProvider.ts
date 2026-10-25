import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider } from "alepha/redis";

import { CacheProvider } from "./CacheProvider.ts";

/**
 * Cache entries in Redis.
 *
 * Every key is `<alepha.name>:cache:<container>:<key>`, so two apps on one
 * Redis never read or overwrite each other's entries, and `clear()` deletes
 * this app's namespace only. Set `APP_NAME` to separate two environments of
 * one app.
 */
export class RedisCacheProvider extends CacheProvider {
  protected readonly log = $logger();
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly alepha = $inject(Alepha);

  public async get(name: string, key: string): Promise<Uint8Array | undefined> {
    if (!this.alepha.isStarted()) {
      return;
    }

    const keyWithPrefix = this.prefix(name, this.escapeKey(key));
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
    // Started, not ready: a write issued from a start hook must land, the
    // client is open by then. Gating on ready() silently dropped it.
    if (!this.alepha.isStarted()) {
      return new Uint8Array(Buffer.from(value));
    }

    const buffer = Buffer.from(value);
    const prefix = this.prefix(name, this.escapeKey(key));

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
      const matched = this.ownKeys(
        `${nameKey}:`,
        await this.redisProvider.keys(`${this.pattern(name)}:*`),
      );
      if (matched.length > 0) {
        await this.redisProvider.del(matched);
      }
      return;
    }

    // Caller-side keys, always. This used to accept either form and guess
    // between them with `key.startsWith(nameKey)`, because `keys()` handed
    // back storage keys; now that it does not, there is one form and no
    // guess - and a caller whose own key happened to start with the
    // container prefix is no longer silently mistaken for a storage key.
    const prefixed = keys.map((key) => this.prefix(name, this.escapeKey(key)));
    if (prefixed.length > 0) {
      await this.redisProvider.del(prefixed);
    }
  }

  public async has(name: string, key: string): Promise<boolean> {
    return this.redisProvider.has(this.prefix(name, this.escapeKey(key)));
  }

  public async keys(name: string, filter?: string): Promise<string[]> {
    const prefix = `${this.prefix(name)}:`;
    const pattern = filter
      ? `${this.pattern(name)}:${this.escapeKey(filter)}*`
      : `${this.pattern(name)}:*`;
    return this.callerKeys(prefix, await this.redisProvider.keys(pattern));
  }

  public async clear(): Promise<void> {
    this.log.debug("Clearing all cache");
    // This app's namespace only: `cache:*` used to wipe every app's cache
    // on a shared Redis.
    const pattern = `${this.pattern()}:*`;
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
    const keyWithPrefix = this.prefix(name, this.escapeKey(key));
    return this.redisProvider.incr(keyWithPrefix, amount, ttl);
  }

  /**
   * The Redis key: `<alepha.name>:cache:<path...>`.
   */
  protected prefix(...path: string[]): string {
    return [this.alepha.name, "cache", ...path].join(":");
  }

  /**
   * {@link prefix} as a `KEYS` pattern: the app name is glob-escaped, so an
   * `APP_NAME` holding `*`, `?` or `[` matches only itself.
   */
  protected pattern(...path: string[]): string {
    return [
      this.alepha.name.replace(/[*?[\]\\]/g, "\\$&"),
      "cache",
      ...path,
    ].join(":");
  }
}
