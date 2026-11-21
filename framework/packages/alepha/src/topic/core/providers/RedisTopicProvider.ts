import { $hook, $inject } from "alepha";
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
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly redisSubscriberProvider = $inject(RedisSubscriberProvider);

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
   * Subscribe to a topic.
   *
   * Topic names containing the wildcard char (parameterized topics) go
   * through PSUBSCRIBE: a plain SUBSCRIBE would treat the pattern as a
   * literal channel name and silently never receive anything.
   *
   * Each call registers a listener of its own, which strips the Redis
   * channel prefix so param extraction sees the bare topic name. The
   * returned function removes that listener and no other: the same callback
   * subscribed to a second topic, and the other listeners of this one, keep
   * receiving, and calling it again does nothing. A call that fails (the
   * subscriber is not connected) removed nothing and can be made again.
   */
  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    _options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const listener: SubscribeCallback = (message, channel) =>
      callback(message, channel === undefined ? name : this.unprefix(channel));

    // Subscribe first to avoid message loss window
    if (this.isPattern(name)) {
      await this.redisSubscriberProvider.pSubscribe(
        this.pattern(name),
        listener,
      );
    } else {
      const topic = this.prefix(name);
      await this.redisSubscriberProvider.subscribe(topic, listener);

      // Then deliver retained message if exists (literal channels only:
      // a pattern has no single retained key)
      const retained = await this.redisProvider.get(`${topic}:retained`);
      if (retained) {
        await callback(retained.toString(), name);
      }
    }

    let subscribed = true;
    return async () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;

      try {
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
      } catch (error) {
        // Not removed (the subscriber is closed or reconnecting): the
        // listener is still registered, so a later call must try again.
        subscribed = true;
        throw error;
      }
    };
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
