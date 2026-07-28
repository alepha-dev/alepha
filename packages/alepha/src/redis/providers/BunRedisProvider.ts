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

  /** Keys examined per SCAN round-trip — see NodeRedisProvider.SCAN_COUNT. */
  protected static readonly SCAN_COUNT = 500;

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

    // Expiration-only options go through the typed native overloads, which
    // accept raw bytes. The raw `send` fallback UTF-8-encodes every string
    // argument, so any byte ≥ 0x80 (compressed / Uint8Array / non-ASCII
    // cache values) would be double-encoded and stored corrupted.
    const hasCondition =
      options?.condition !== undefined ||
      options?.NX ||
      options?.XX ||
      options?.GET;

    if (options && !hasCondition) {
      await this.setWithExpiration(key, buf, options);
      return buf;
    }

    if (hasCondition && !buf.every((byte) => byte <= 0x7f)) {
      // The conditional path can only use `send` (the typed API has no
      // combined NX/GET/PX overloads) — refuse loudly instead of silently
      // corrupting the value.
      throw new AlephaError(
        "Bun Redis: SET with NX/XX/GET options only supports ASCII-safe values — the raw command path UTF-8-encodes arguments and would corrupt binary data.",
      );
    }

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

  /**
   * Apply a SET with expiration options through the typed native overloads
   * (binary-safe — values are passed as raw bytes, never re-encoded).
   */
  protected async setWithExpiration(
    key: string,
    buf: Buffer,
    options: RedisSetOptions,
  ): Promise<void> {
    const expiration = options.expiration;
    if (expiration && expiration.type !== "KEEPTTL") {
      await this.publisher.set(
        key,
        buf,
        expiration.type as "PX",
        expiration.value,
      );
      return;
    }
    if (options.EX !== undefined) {
      await this.publisher.set(key, buf, "EX", options.EX);
      return;
    }
    if (options.PX !== undefined) {
      await this.publisher.set(key, buf, "PX", options.PX);
      return;
    }
    if (options.EXAT !== undefined) {
      await this.publisher.set(key, buf, "EXAT", options.EXAT);
      return;
    }
    if (options.PXAT !== undefined) {
      await this.publisher.set(key, buf, "PXAT", options.PXAT);
      return;
    }
    if (expiration?.type === "KEEPTTL" || options.KEEPTTL) {
      await this.publisher.set(key, buf, "KEEPTTL");
      return;
    }
    await this.publisher.set(key, buf);
  }

  public override async has(key: string): Promise<boolean> {
    return this.publisher.exists(key);
  }

  /**
   * One SCAN page. Seam for tests, and the place the page size is decided.
   */
  protected async scanPage(
    cursor: string,
    pattern: string,
  ): Promise<{ cursor: string; keys: string[] }> {
    const reply = await this.publisher.send("SCAN", [
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      String(BunRedisProvider.SCAN_COUNT),
    ]);

    const decode = (key: unknown) =>
      key instanceof Uint8Array ? Buffer.from(key).toString() : String(key);

    if (!Array.isArray(reply) || reply.length < 2) {
      return { cursor: "0", keys: [] };
    }

    return {
      cursor: decode(reply[0]),
      keys: Array.isArray(reply[1]) ? reply[1].map(decode) : [],
    };
  }

  public override async keys(pattern: string): Promise<string[]> {
    // Cursor traversal, not `KEYS` — see NodeRedisProvider.keys for why.
    const found = new Set<string>();
    let cursor = "0";

    do {
      const page = await this.scanPage(cursor, pattern);
      for (const key of page.keys) {
        found.add(key);
      }
      cursor = page.cursor;
    } while (cursor !== "0");

    return [...found];
  }

  public override async del(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    // UNLINK frees on a background thread; DEL blocks for the whole free.
    await this.publisher.send("UNLINK", keys);
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
