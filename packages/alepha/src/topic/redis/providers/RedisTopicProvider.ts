import { $atom, $hook, $inject, $state, Alepha, type Static, z } from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider, RedisSubscriberProvider } from "alepha/redis";
import {
  type SubscribeCallback,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "alepha/topic";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis topic configuration atom.
 */
export const redisTopicOptions = $atom({
  name: "alepha.topic.redis.options",
  schema: z.object({
    prefix: z.text({
      default: "topic",
      description: "Prefix for all topic channels in Redis.",
    }),
  }),
  default: {
    prefix: "topic",
  },
  serverOnly: true,
});

export type RedisTopicOptions = Static<typeof redisTopicOptions.schema>;

declare module "alepha" {
  interface State {
    [redisTopicOptions.key]: RedisTopicOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class RedisTopicProvider extends TopicProvider {
  protected readonly options = $state(redisTopicOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider = $inject(RedisProvider);
  protected readonly redisSubscriberProvider = $inject(RedisSubscriberProvider);

  protected readonly log = $logger();

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      const subscribers = this.subscribers();
      if (subscribers.length) {
        await Promise.all(subscribers.map((fn) => fn()));
        for (const subscriber of subscribers) {
          this.log.debug(`Subscribed to topic '${subscriber.name}'`);
        }
      }
    },
  });

  protected override wildcardChar(): string {
    return "*";
  }

  public prefix(queue: string): string {
    return `${this.options.prefix}:${queue}`;
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
    const topic = this.prefix(name);

    const listener: SubscribeCallback = (message, channel) =>
      callback(message, channel === undefined ? name : this.unprefix(channel));
    this.listeners.set(callback, listener);

    // Subscribe first to avoid message loss window
    if (this.isPattern(name)) {
      await this.redisSubscriberProvider.pSubscribe(topic, listener);
    } else {
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
    const topic = this.prefix(name);
    const listener = callback ? this.listeners.get(callback) : undefined;
    if (callback) {
      this.listeners.delete(callback);
    }

    if (this.isPattern(name)) {
      await this.redisSubscriberProvider.pUnsubscribe(topic, listener);
    } else {
      await this.redisSubscriberProvider.unsubscribe(topic, listener);
    }
  }

  protected isPattern(name: string): boolean {
    const wildcard = this.wildcardChar();
    return wildcard !== undefined && name.includes(wildcard);
  }

  protected unprefix(channel: string): string {
    const prefix = `${this.options.prefix}:`;
    return channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
  }
}
