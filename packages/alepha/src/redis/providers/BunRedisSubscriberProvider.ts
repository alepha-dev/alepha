import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { BunRedisProvider } from "./BunRedisProvider.ts";
import {
  RedisSubscriberProvider,
  type SubscribeCallback,
} from "./RedisSubscriberProvider.ts";

/**
 * Bun Redis subscriber provider for pub/sub operations.
 *
 * This provider creates a dedicated Redis connection for subscriptions,
 * as Redis requires separate connections for pub/sub operations.
 *
 * @example
 * ```ts
 * const subscriber = alepha.inject(RedisSubscriberProvider);
 * await subscriber.subscribe("channel", (message, channel) => {
 *   console.log(`Received: ${message} on ${channel}`);
 * });
 * ```
 */
export class BunRedisSubscriberProvider extends RedisSubscriberProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider = $inject(BunRedisProvider);
  protected client?: Bun.RedisClient;

  public get subscriber(): Bun.RedisClient {
    if (!this.client?.connected) {
      throw new AlephaError("Redis subscriber client is not ready");
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
   * Connect to the Redis server for subscriptions.
   */
  public override async connect(): Promise<void> {
    this.log.debug("Connecting subscriber...");
    this.client = await this.redisProvider.duplicate();
    this.log.info("Subscriber connection OK");
  }

  /**
   * Close the subscriber connection.
   */
  public override async close(): Promise<void> {
    if (this.client) {
      this.log.debug("Closing subscriber connection...");
      this.client.close();
      this.client = undefined;
      this.log.info("Subscriber connection closed");
    }
  }

  public override async subscribe(
    channel: string,
    callback: SubscribeCallback,
  ): Promise<void> {
    await this.subscriber.subscribe(channel, (message, ch) => {
      // Bun's callback provides Buffer or string, normalize to string
      const msg =
        typeof message === "object" && message !== null
          ? Buffer.from(message as Uint8Array).toString()
          : String(message);
      callback(msg, ch);
    });
  }

  public override async unsubscribe(
    channel: string,
    _callback?: SubscribeCallback,
  ): Promise<void> {
    // Bun's unsubscribe doesn't support callback filtering
    await this.subscriber.unsubscribe(channel);
  }

  public override async pSubscribe(
    _pattern: string,
    _callback: SubscribeCallback,
  ): Promise<void> {
    // Failing loudly beats a plain SUBSCRIBE on the pattern, which would be
    // treated as a literal channel name and silently never receive anything.
    throw new AlephaError(
      "Bun's native Redis client does not support PSUBSCRIBE — parameterized topics are not available with BunRedisSubscriberProvider.",
    );
  }

  public override async pUnsubscribe(
    _pattern: string,
    _callback?: SubscribeCallback,
  ): Promise<void> {
    throw new AlephaError(
      "Bun's native Redis client does not support PUNSUBSCRIBE — parameterized topics are not available with BunRedisSubscriberProvider.",
    );
  }
}
