import { $atom, $hook, $inject, $use, Alepha, type Static, t } from "alepha";
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
  schema: t.object({
    prefix: t.text({
      default: "topic",
      description: "Prefix for all topic channels in Redis.",
    }),
  }),
  default: {
    prefix: "topic",
  },
});

export type RedisTopicOptions = Static<typeof redisTopicOptions.schema>;

declare module "alepha" {
  interface State {
    [redisTopicOptions.key]: RedisTopicOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class RedisTopicProvider extends TopicProvider {
  protected readonly options = $use(redisTopicOptions);
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
   * Subscribe to a topic.
   */
  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    _options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const topic = this.prefix(name);

    // Deliver retained message if exists
    const retained = await this.redisProvider.get(`${topic}:retained`);
    if (retained) {
      await callback(retained.toString());
    }

    await this.redisSubscriberProvider.subscribe(topic, callback);

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

    await this.redisSubscriberProvider.unsubscribe(topic, callback);
  }
}
