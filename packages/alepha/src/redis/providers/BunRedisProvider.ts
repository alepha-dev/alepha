import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Static,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider, type RedisSetOptions } from "./RedisProvider.ts";

const envSchema = z.object({
  REDIS_URL: z.text({
    default: "redis://localhost:6379",
    description: "Redis connection URL",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Bun Redis client provider using Bun's native Redis client.
 *
 * This provider uses Bun's built-in `RedisClient` class for Redis connections,
 * which provides excellent performance (7.9x faster than ioredis) on the Bun runtime.
 *
 * @example
 * ```ts
 * // Set REDIS_URL environment variable (default: redis://localhost:6379)
 * // REDIS_URL=redis://:password@myredis.example.com:6379
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: RedisProvider,
 *   use: BunRedisProvider,
 * });
 * ```
 */
export class BunRedisProvider extends RedisProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected client?: Bun.RedisClient;

  public get publisher(): Bun.RedisClient {
    if (!this.client?.connected) {
      throw new AlephaError("Redis client is not ready");
    }

    return this.client;
  }

  public override get isReady(): boolean {
    return this.client?.connected ?? false;
  }

  protected readonly start = $hook({
    on: "start",
    handler: () => this.connect(),
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: () => this.close(),
  });

  /**
   * Connect to the Redis server.
   */
  public override async connect(): Promise<void> {
    // Check if we're running in Bun
    if (!this.alepha.isBun()) {
      throw new AlephaError(
        "BunRedisProvider requires the Bun runtime. Use NodeRedisProvider for Node.js.",
      );
    }

    this.log.debug("Connecting...");

    this.client = new Bun.RedisClient(this.getUrl(), {
      autoReconnect: true,
      enableAutoPipelining: true,
    });

    this.client.onconnect = () => {
      this.log.trace("Redis connected");
    };

    this.client.onclose = (error) => {
      if (this.alepha.isStarted() && error) {
        this.log.error("Redis connection closed", error);
      }
    };

    await this.client.connect();

    this.log.info("Connection OK");
  }

  /**
   * Close the connection to the Redis server.
   */
  public override async close(): Promise<void> {
    if (this.client) {
      this.log.debug("Closing connection...");
      this.client.close();
      this.client = undefined;
      this.log.info("Connection closed");
    }
  }

  /**
   * Create a duplicate connection for pub/sub or other isolated operations.
   */
  public async duplicate(): Promise<Bun.RedisClient> {
    if (typeof Bun === "undefined") {
      throw new AlephaError("BunRedisProvider requires the Bun runtime.");
    }

    const client = new Bun.RedisClient(this.getUrl(), {
      autoReconnect: true,
      enableAutoPipelining: true,
    });

    client.onclose = (error) => {
      if (this.alepha.isStarted() && error) {
        this.log.error("Redis duplicate connection closed", error);
      }
    };

    await client.connect();

    return client;
  }

  public override async get(key: string): Promise<Buffer | undefined> {
    this.log.trace(`Getting key ${key}`);
    const resp = await this.publisher.getBuffer(key);

    if (resp === null) {
      return undefined;
    }

    return Buffer.from(resp);
  }

  public override async set(
    key: string,
    value: Buffer | string,
    options?: RedisSetOptions,
  ): Promise<Buffer> {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf-8");

    // Build SET command arguments
    const args: string[] = [key, buf.toString("binary")];

    // Handle expiration object format (from alepha/cache-redis, alepha/lock-redis)
    if (options?.expiration) {
      if (options.expiration.type === "KEEPTTL") {
        args.push("KEEPTTL");
      } else {
        args.push(options.expiration.type, String(options.expiration.value));
      }
    }

    // Handle direct expiration properties
    if (options?.EX !== undefined) {
      args.push("EX", String(options.EX));
    }
    if (options?.PX !== undefined) {
      args.push("PX", String(options.PX));
    }
    if (options?.EXAT !== undefined) {
      args.push("EXAT", String(options.EXAT));
    }
    if (options?.PXAT !== undefined) {
      args.push("PXAT", String(options.PXAT));
    }
    if (options?.KEEPTTL) {
      args.push("KEEPTTL");
    }

    // Handle condition object format
    if (options?.condition === "NX") {
      args.push("NX");
    } else if (options?.condition === "XX") {
      args.push("XX");
    }

    // Handle direct condition properties
    if (options?.NX) {
      args.push("NX");
    }
    if (options?.XX) {
      args.push("XX");
    }
    if (options?.GET) {
      args.push("GET");
    }

    // Capture the reply. With the `GET` option the reply carries the *prior*
    // value, and the entire `$lock` protocol (`SET … NX GET`) depends on reading
    // it. Previously this discarded the reply and always returned the value it
    // just wrote, so under Bun every lock contender saw its own id back and
    // believed it had acquired the lock — RedisLockProvider (and therefore every
    // scheduler dedup / migration guard) became a silent no-op across instances.
    const resp =
      args.length === 2
        ? await this.publisher.set(key, buf)
        : await this.publisher.send("SET", args);

    // Mirror NodeRedisProvider: "OK"/nil means "applied, no prior value" → echo
    // the value we wrote; any other reply is the prior value returned by GET.
    if (resp == null || resp === "OK") {
      return buf;
    }
    return Buffer.isBuffer(resp) ? resp : Buffer.from(String(resp), "binary");
  }

  public override async has(key: string): Promise<boolean> {
    return this.publisher.exists(key);
  }

  public override async keys(pattern: string): Promise<string[]> {
    const keys = await this.publisher.send("KEYS", [pattern]);
    if (!Array.isArray(keys)) {
      return [];
    }
    return keys.map((key) =>
      key instanceof Uint8Array ? Buffer.from(key).toString() : String(key),
    );
  }

  public override async del(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.publisher.send("DEL", keys);
  }

  // ---------------------------------------------------------
  // Queue operations
  // ---------------------------------------------------------

  public override async lpush(key: string, value: string): Promise<void> {
    await this.publisher.send("LPUSH", [key, value]);
  }

  public override async rpop(key: string): Promise<string | undefined> {
    const value = await this.publisher.send("RPOP", [key]);
    if (value == null) {
      return undefined;
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString();
    }
    return String(value);
  }

  // ---------------------------------------------------------
  // Pub/Sub operations
  // ---------------------------------------------------------

  public override async publish(
    channel: string,
    message: string,
  ): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  // ---------------------------------------------------------
  // Counter operations
  // ---------------------------------------------------------

  public override async incr(
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    const result = Number(
      await this.publisher.send("INCRBY", [key, String(amount)]),
    );
    // INCRBY is atomic, so exactly one concurrent caller observes the
    // "creation" value and arms the expiry (fixed window).
    if (ttl && result === amount) {
      await this.publisher.send("PEXPIRE", [key, String(Math.ceil(ttl))]);
    }
    return result;
  }

  /**
   * Get the Redis connection URL.
   */
  protected getUrl(): string {
    return this.env.REDIS_URL;
  }
}
