import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Static,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import type { RedisClient as BunRedisClient } from "bun";
import { RedisProvider, type RedisSetOptions } from "./RedisProvider.ts";

const envSchema = t.object({
  REDIS_URL: t.optional(t.text()),
  REDIS_PORT: t.integer({
    default: "6379",
  }),
  REDIS_HOST: t.text({
    default: "localhost",
  }),
  REDIS_PASSWORD: t.optional(t.text()),
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
 * // Set REDIS_URL environment variable
 * // REDIS_URL=redis://localhost:6379
 *
 * // Or configure via REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
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
  protected client?: BunRedisClient;

  public get publisher(): BunRedisClient {
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
    if (typeof Bun === "undefined") {
      throw new AlephaError(
        "BunRedisProvider requires the Bun runtime. Use NodeRedisProvider for Node.js.",
      );
    }

    this.log.debug("Connecting...");

    const { RedisClient } = await import("bun");

    this.client = new RedisClient(this.getUrl(), {
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
  public async duplicate(): Promise<BunRedisClient> {
    if (typeof Bun === "undefined") {
      throw new AlephaError("BunRedisProvider requires the Bun runtime.");
    }

    const { RedisClient } = await import("bun");

    const client = new RedisClient(this.getUrl(), {
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

    if (args.length === 2) {
      // Simple set without options
      await this.publisher.set(key, buf);
    } else {
      // Set with options via raw command
      await this.publisher.send("SET", args);
    }

    return buf;
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

  /**
   * Get the Redis connection URL.
   */
  protected getUrl(): string {
    // Prefer REDIS_URL if set
    if (this.env.REDIS_URL) {
      return this.env.REDIS_URL;
    }

    // Build URL from components
    const url = new URL("redis://127.0.0.1:6379");

    if (this.env.REDIS_PASSWORD) {
      url.password = this.env.REDIS_PASSWORD;
    }

    if (this.env.REDIS_HOST) {
      url.hostname = this.env.REDIS_HOST;
    }

    if (this.env.REDIS_PORT) {
      url.port = String(this.env.REDIS_PORT);
    }

    return url.toString();
  }
}
