import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider, RedisSubscriberProvider } from "alepha/redis";

import {
  type SubscribeCallback,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "./TopicProvider.ts";

/**
 * Topics over Redis pub/sub.
 *
 * Every channel and retained key is `<alepha.name>:topic:<name>`, so two apps
 * (or two environments of one app) on the same Redis never receive each
 * other's messages, the framework's own `websocket:broadcast`,
 * `parameter:sync` and `lock:end` included. Set `APP_NAME` to separate them.
 */
export class RedisTopicProvider extends TopicProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly redisSubscriberProvider = $inject(RedisSubscriberProvider);

  protected readonly log = $logger();

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      const subscribers = this.subscribers();
      if (subscribers.length) {
        await Promise.all(subscribers.map((it) => it.subscribe()));
        for (const subscriber of subscribers) {
          this.log.debug(`Subscribed to topic '${subscriber.name}'`);
        }
      }
    },
  });

  protected override wildcardChar(): string {
    return "*";
  }

  /**
   * The Redis channel of a topic: `<alepha.name>:topic:<name>`.
   */
  public prefix(name: string): string {
    return `${this.namespace()}${name}`;
  }

  /**
   * `<alepha.name>:topic:`, read on every call like `alepha.name` itself.
   */
  protected namespace(): string {
    return `${this.alepha.name}:topic:`;
  }

  /**
   * The PSUBSCRIBE pattern of a parameterized topic.
   *
   * The namespace is glob-escaped, so an `APP_NAME` holding `*`, `?` or `[`
   * matches only itself; the topic's own wildcards stay live.
   */
  protected pattern(name: string): string {
    return `${this.namespace().replace(/[*?[\]\\]/g, "\\$&")}${name}`;
  }

  /**
   * Publish a message to a topic.
   */
  public async publish(
    topic: string,
    message: string,
    options?: TopicPublishOptions,
  ): Promise<void> {
    if (options?.retain) {
      await this.redisProvider.set(`${this.prefix(topic)}:retained`, message);
    }
    await this.redisProvider.publish(this.prefix(topic), message);
  }

  /**
   * Wrapped listeners by original callback — the wrapper strips the Redis
   * channel prefix so param extraction sees the bare topic name, and the map
   * preserves listener identity for unsubscribe.
   */
  protected readonly listeners = new Map<
    SubscribeCallback,
    SubscribeCallback
  >();

  /**
   * Subscribe to a topic.
   *
   * Topic names containing the wildcard char (parameterized topics) go
   * through PSUBSCRIBE — a plain SUBSCRIBE would treat the pattern as a
   * literal channel name and silently never receive anything.
   */
  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    _options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const listener: SubscribeCallback = (message, channel) =>
      callback(message, channel === undefined ? name : this.unprefix(channel));
    this.listeners.set(callback, listener);

    // Subscribe first to avoid message loss window
    if (this.isPattern(name)) {
      await this.redisSubscriberProvider.pSubscribe(
        this.pattern(name),
        listener,
      );
    } else {
      const topic = this.prefix(name);
      await this.redisSubscriberProvider.subscribe(topic, listener);

      // Then deliver retained message if exists (literal channels only —
      // a pattern has no single retained key)
      const retained = await this.redisProvider.get(`${topic}:retained`);
      if (retained) {
        await callback(retained.toString(), name);
      }
    }

    return () => this.unsubscribe(name, callback);
  }

  /**
   * Unsubscribe from a topic.
   */
  public async unsubscribe(
    name: string,
    callback?: SubscribeCallback,
  ): Promise<void> {
    const listener = callback ? this.listeners.get(callback) : undefined;
    if (callback) {
      this.listeners.delete(callback);
    }

    if (this.isPattern(name)) {
      await this.redisSubscriberProvider.pUnsubscribe(
        this.pattern(name),
        listener,
      );
    } else {
      await this.redisSubscriberProvider.unsubscribe(
        this.prefix(name),
        listener,
      );
    }
  }

  protected isPattern(name: string): boolean {
    const wildcard = this.wildcardChar();
    return wildcard !== undefined && name.includes(wildcard);
  }

  protected unprefix(channel: string): string {
    const prefix = this.namespace();
    return channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
  }
}
