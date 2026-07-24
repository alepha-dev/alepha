/**
 * Abstract Redis provider interface.
 *
 * This abstract class defines the common interface for Redis operations.
 * Implementations include:
 * - {@link NodeRedisProvider} - Uses `@redis/client` for Node.js runtime
 * - {@link BunRedisProvider} - Uses Bun's native `RedisClient` for Bun runtime
 *
 * @example
 * ```ts
 * // Inject the abstract provider - runtime selects the implementation
 * const redis = alepha.inject(RedisProvider);
 *
 * // Use common operations
 * await redis.set("key", "value");
 * const value = await redis.get("key");
 * ```
 */
export abstract class RedisProvider {
  /**
   * Whether the Redis client is ready to accept commands.
   */
  public abstract readonly isReady: boolean;

  /**
   * Connect to the Redis server.
   */
  public abstract connect(): Promise<void>;

  /**
   * Close the connection to the Redis server.
   */
  public abstract close(): Promise<void>;

  /**
   * Get the value of a key.
   *
   * @param key The key to get.
   * @returns The value as a Buffer, or undefined if the key does not exist.
   */
  public abstract get(key: string): Promise<Buffer | undefined>;

  /**
   * Set the value of a key.
   *
   * @param key The key to set.
   * @param value The value to set (Buffer or string).
   * @param options Optional set options (EX, PX, NX, XX, etc.).
   * @returns The value as a Buffer.
   */
  public abstract set(
    key: string,
    value: Buffer | string,
    options?: RedisSetOptions,
  ): Promise<Buffer>;

  /**
   * Check if a key exists.
   *
   * @param key The key to check.
   * @returns True if the key exists.
   */
  public abstract has(key: string): Promise<boolean>;

  /**
   * Get all keys matching a pattern.
   *
   * @param pattern The glob-style pattern to match.
   * @returns Array of matching key names.
   */
  public abstract keys(pattern: string): Promise<string[]>;

  /**
   * Delete one or more keys.
   *
   * @param keys The keys to delete.
   */
  public abstract del(keys: string[]): Promise<void>;

  // ---------------------------------------------------------
  // Queue operations (for alepha/queue-redis)
  // ---------------------------------------------------------

  /**
   * Push a value to the left (head) of a list.
   *
   * @param key The list key.
   * @param value The value to push.
   */
  public abstract lpush(key: string, value: string): Promise<void>;

  /**
   * Pop a value from the right (tail) of a list.
   *
   * @param key The list key.
   * @returns The value, or undefined if the list is empty.
   */
  public abstract rpop(key: string): Promise<string | undefined>;

  // ---------------------------------------------------------
  // Pub/Sub operations (for alepha/topic-redis)
  // ---------------------------------------------------------

  /**
   * Publish a message to a channel.
   *
   * @param channel The channel name.
   * @param message The message to publish.
   */
  public abstract publish(channel: string, message: string): Promise<void>;

  // ---------------------------------------------------------
  // Counter operations
  // ---------------------------------------------------------

  /**
   * Increment the integer value of a key by the given amount.
   *
   * If the key does not exist, it is set to 0 before performing the operation.
   * This operation is atomic.
   *
   * @param key The key to increment.
   * @param amount The amount to increment by.
   * @param ttl Optional lifetime in milliseconds, armed when the counter is
   * created (fixed window — increments do not extend it).
   * @returns The new value after incrementing.
   */
  public abstract incr(
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number>;
}

/**
 * Common Redis SET command options.
 * Compatible with @redis/client SetOptions format.
 */
export interface RedisSetOptions {
  /**
   * Set the specified expire time, in seconds.
   */
  EX?: number;
  /**
   * Set the specified expire time, in milliseconds.
   */
  PX?: number;
  /**
   * Set the specified Unix time at which the key will expire, in seconds.
   */
  EXAT?: number;
  /**
   * Set the specified Unix time at which the key will expire, in milliseconds.
   */
  PXAT?: number;
  /**
   * Only set the key if it does not already exist.
   */
  NX?: boolean;
  /**
   * Only set the key if it already exists.
   */
  XX?: boolean;
  /**
   * Retain the time to live associated with the key.
   */
  KEEPTTL?: boolean;
  /**
   * Return the old string stored at key, or nil if key did not exist.
   */
  GET?: boolean;
  /**
   * Alternative expiration format (compatible with @redis/client).
   */
  expiration?: {
    type: "EX" | "PX" | "EXAT" | "PXAT" | "KEEPTTL";
    value: number;
  };
  /**
   * Alternative condition format (compatible with @redis/client).
   */
  condition?: "NX" | "XX";
}
