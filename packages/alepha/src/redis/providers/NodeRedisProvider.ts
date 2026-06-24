import {
  createClient,
  RESP_TYPES,
  type RedisClientType,
  type SetOptions,
} from "@redis/client";
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

export type NodeRedisClient = RedisClientType<
  {},
  {},
  {},
  3,
  { 36: BufferConstructor }
>;
export type NodeRedisClientOptions = Parameters<typeof createClient>[0];

/**
 * Node.js Redis client provider using `@redis/client`.
 *
 * This provider uses the official Redis client for Node.js runtime.
 *
 * @example
 * ```ts
 * // Set REDIS_URL environment variable (default: redis://localhost:6379)
 * // REDIS_URL=redis://:password@myredis.example.com:6379
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: RedisProvider,
 *   use: NodeRedisProvider,
 * });
 * ```
 */
export class NodeRedisProvider extends RedisProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly client = this.createClient();

  public get publisher(): NodeRedisClient {
    if (!this.client.isReady) {
      throw new AlephaError("Redis client is not ready");
    }

    return this.client;
  }

  public override get isReady(): boolean {
    return this.client.isReady;
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
    this.log.debug("Connecting...");
    await this.client.connect();
    this.log.info("Connection OK");
  }

  /**
   * Close the connection to the Redis server.
   */
  public override async close(): Promise<void> {
    this.log.debug("Closing connection...");
    await this.client.close();
    this.log.info("Connection closed");
  }

  public duplicate(options?: Partial<NodeRedisClientOptions>): NodeRedisClient {
    return this.client
      .duplicate({
        ...options,
        RESP: 3,
      })
      .withTypeMapping({
        [RESP_TYPES.BLOB_STRING]: Buffer,
      });
  }

  public override async get(key: string): Promise<Buffer | undefined> {
    this.log.trace(`Getting key ${key}`);
    const resp = await this.publisher.get(key);

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

    // Convert RedisSetOptions to @redis/client SetOptions
    const setOptions: SetOptions = {};

    // Handle expiration object format (from alepha/cache-redis, alepha/lock-redis)
    if (options?.expiration) {
      if (options.expiration.type === "KEEPTTL") {
        setOptions.KEEPTTL = true;
      } else {
        setOptions[options.expiration.type] = options.expiration.value;
      }
    }

    // Handle direct expiration properties
    if (options?.EX !== undefined) {
      setOptions.EX = options.EX;
    }
    if (options?.PX !== undefined) {
      setOptions.PX = options.PX;
    }
    if (options?.EXAT !== undefined) {
      setOptions.EXAT = options.EXAT;
    }
    if (options?.PXAT !== undefined) {
      setOptions.PXAT = options.PXAT;
    }
    if (options?.KEEPTTL) {
      setOptions.KEEPTTL = true;
    }

    // Handle condition object format
    if (options?.condition === "NX") {
      setOptions.NX = true;
    } else if (options?.condition === "XX") {
      setOptions.XX = true;
    }

    // Handle direct condition properties
    if (options?.NX) {
      setOptions.NX = true;
    }
    if (options?.XX) {
      setOptions.XX = true;
    }
    if (options?.GET) {
      setOptions.GET = true;
    }

    const resp = await this.publisher.set(
      key,
      buf,
      Object.keys(setOptions).length > 0 ? setOptions : undefined,
    );

    if (resp === "OK" || !resp) {
      return buf;
    }

    return Buffer.from(resp);
  }

  public override async has(key: string): Promise<boolean> {
    const resp = await this.publisher.exists(key);
    return resp > 0;
  }

  public override async keys(pattern: string): Promise<string[]> {
    const keys = await this.publisher.keys(pattern);
    return keys.map((key) => key.toString());
  }

  public override async del(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.publisher.del(keys);
  }

  // ---------------------------------------------------------
  // Queue operations
  // ---------------------------------------------------------

  public override async lpush(key: string, value: string): Promise<void> {
    await this.publisher.LPUSH(key, value);
  }

  public override async rpop(key: string): Promise<string | undefined> {
    const value = await this.publisher.RPOP(key);
    if (value == null) {
      return undefined;
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

  public override async incr(key: string, amount: number): Promise<number> {
    return this.publisher.INCRBY(key, amount);
  }

  /**
   * Get the Redis connection URL.
   */
  protected getUrl(): string {
    return this.env.REDIS_URL;
  }

  /**
   * Redis client factory method.
   */
  protected createClient(): NodeRedisClient {
    const client = createClient({
      url: this.getUrl(),
      RESP: 3,
    }).withTypeMapping({
      [RESP_TYPES.BLOB_STRING]: Buffer,
    });

    client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error(error);
      }
    });

    return client;
  }
}
