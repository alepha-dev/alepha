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

  /**
   * The listener handed to Bun for each callback, by channel. `subscribe`
   * wraps the callback to normalize the message, so removing one callback
   * means finding the wrapper Bun knows.
   */
  protected readonly listeners = new Map<
    string,
    Map<SubscribeCallback, Bun.RedisClient.StringPubSubListener>
  >();

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
      this.listeners.clear();
      this.log.info("Subscriber connection closed");
    }
  }

  public override async subscribe(
    channel: string,
    callback: SubscribeCallback,
  ): Promise<void> {
    const subscriber = this.subscriber;
    const listener: Bun.RedisClient.StringPubSubListener = (message, ch) => {
      // Bun's callback provides Buffer or string, normalize to string
      const msg =
        typeof message === "object" && message !== null
          ? Buffer.from(message as Uint8Array).toString()
          : String(message);
      callback(msg, ch);
    };

    let listeners = this.listeners.get(channel);
    if (!listeners) {
      listeners = new Map();
      this.listeners.set(channel, listeners);
    }
    // The same callback subscribed twice to one channel is one listener.
    if (listeners.has(callback)) {
      return;
    }
    listeners.set(callback, listener);

    try {
      await subscriber.subscribe(channel, listener);
    } catch (error) {
      // Not subscribed: forget the listener, or a later subscribe of this
      // callback would take it for done.
      this.forget(channel, callback);
      throw error;
    }
  }

  public override async unsubscribe(
    channel: string,
    callback?: SubscribeCallback,
  ): Promise<void> {
    // Nothing subscribed here: Bun refuses an UNSUBSCRIBE outside
    // subscriber mode, which is where the last removal leaves the client.
    const listeners = this.listeners.get(channel);
    if (!listeners) {
      return;
    }

    // Read first: the getter throws when the client is not connected, and
    // nothing must be forgotten then.
    const subscriber = this.subscriber;

    if (!callback) {
      this.listeners.delete(channel);
      try {
        await subscriber.unsubscribe(channel);
      } catch (error) {
        this.listeners.set(channel, listeners);
        throw error;
      }
      return;
    }

    const listener = listeners.get(callback);
    if (!listener) {
      return;
    }

    this.forget(channel, callback);
    try {
      await subscriber.unsubscribe(channel, listener);
    } catch (error) {
      // Not removed: keep the listener, so the removal can be tried again.
      let current = this.listeners.get(channel);
      if (!current) {
        current = new Map();
        this.listeners.set(channel, current);
      }
      current.set(callback, listener);
      throw error;
    }
  }

  /**
   * Drop a callback's listener from the map, and the channel's entry with
   * its last one.
   */
  protected forget(channel: string, callback: SubscribeCallback): void {
    const listeners = this.listeners.get(channel);
    if (!listeners) {
      return;
    }

    listeners.delete(callback);
    if (listeners.size === 0) {
      this.listeners.delete(channel);
    }
  }

  public override async pSubscribe(
    _pattern: string,
    _callback: SubscribeCallback,
  ): Promise<void> {
    // Failing loudly beats a plain SUBSCRIBE on the pattern, which would be
    // treated as a literal channel name and silently never receive anything.
    throw new AlephaError(
      "Bun's native Redis client does not support PSUBSCRIBE: parameterized topics are not available with BunRedisSubscriberProvider.",
    );
  }

  public override async pUnsubscribe(
    _pattern: string,
    _callback?: SubscribeCallback,
  ): Promise<void> {
    throw new AlephaError(
      "Bun's native Redis client does not support PUNSUBSCRIBE: parameterized topics are not available with BunRedisSubscriberProvider.",
    );
  }
}
