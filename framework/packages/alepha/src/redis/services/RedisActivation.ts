import { $inject, Alepha } from "alepha";

/**
 * Answers one question for every module that has a Redis provider: is Redis on?
 *
 * Redis is on when `REDIS_URL` is set, non-empty, in `alepha.env`, and the
 * runtime can run a Redis client (Node or Bun). The variable is read, never a
 * schema value: a default would turn Redis on for every app. With no
 * `REDIS_URL` an app is one instance, and its cache, queue, topic, lock and
 * actors stay in memory.
 *
 * Modules ask it in their `register`, so it reads `alepha.env` as it stands
 * then: `process.env`, a `.env` file and `Alepha.create({ env })`. A later
 * `alepha.loadEnv()` switches nothing.
 *
 * ```ts
 * register: (alepha) => {
 *   const redis = alepha.inject(RedisActivation).isActive();
 *   alepha.with({
 *     optional: true,
 *     provide: CacheProvider,
 *     use: redis ? RedisCacheProvider : MemoryCacheProvider,
 *   });
 * },
 * ```
 */
export class RedisActivation {
  protected readonly alepha = $inject(Alepha);

  /**
   * True when `REDIS_URL` is set and non-empty, on Node or Bun.
   */
  public isActive(): boolean {
    if (!this.isServerRuntime()) {
      return false;
    }

    const url = this.alepha.env.REDIS_URL;
    return typeof url === "string" && url.trim() !== "";
  }

  /**
   * Node or Bun: neither a browser nor a Cloudflare Worker.
   */
  protected isServerRuntime(): boolean {
    if (this.alepha.isBrowser()) {
      return false;
    }

    return (
      typeof (globalThis as { Cloudflare?: unknown }).Cloudflare !== "object"
    );
  }
}
