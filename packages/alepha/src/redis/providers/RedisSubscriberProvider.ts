/**
 * Abstract Redis subscriber provider interface.
 *
 * This abstract class defines the common interface for Redis pub/sub subscriptions.
 * Implementations include:
 * - {@link NodeRedisSubscriberProvider} - Uses `@redis/client` for Node.js runtime
 * - {@link BunRedisSubscriberProvider} - Uses Bun's native `RedisClient` for Bun runtime
 *
 * Redis requires separate connections for pub/sub operations, so this provider
 * creates a dedicated connection for subscriptions.
 *
 * @example
 * ```ts
 * // Inject the abstract provider - runtime selects the implementation
 * const subscriber = alepha.inject(RedisSubscriberProvider);
 *
 * // Subscribe to a channel
 * await subscriber.subscribe("my-channel", (message, channel) => {
 *   console.log(`Received: ${message} on ${channel}`);
 * });
 * ```
 */
export abstract class RedisSubscriberProvider {
  /**
   * Whether the Redis subscriber client is ready to accept commands.
   */
  public abstract readonly isReady: boolean;

  /**
   * Connect to the Redis server for subscriptions.
   */
  public abstract connect(): Promise<void>;

  /**
   * Close the subscriber connection.
   */
  public abstract close(): Promise<void>;

  /**
   * Subscribe to a channel.
   *
   * @param channel The channel name.
   * @param callback The callback to invoke when a message is received.
   */
  public abstract subscribe(
    channel: string,
    callback: SubscribeCallback,
  ): Promise<void>;

  /**
   * Unsubscribe from a channel.
   *
   * @param channel The channel name.
   * @param callback Optional specific callback to remove.
   */
  public abstract unsubscribe(
    channel: string,
    callback?: SubscribeCallback,
  ): Promise<void>;
}

/**
 * Callback for subscription messages.
 */
export type SubscribeCallback = (message: string, channel: string) => void;
