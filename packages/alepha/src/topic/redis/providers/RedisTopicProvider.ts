import { $atom, $hook, $inject, $use, Alepha, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider, RedisSubscriberProvider } from "alepha/redis";
import {
  type SubscribeCallback,
  TopicProvider,
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

  public prefix(queue: string): string {
    return `${this.options.prefix}:${queue}`;
  }

  /**
   * Publish a message to a topic.
   */
  public async publish(topic: string, message: string): Promise<void> {
    await this.redisProvider.publish(this.prefix(topic), message);
  }

  /**
   * Subscribe to a topic.
   */
  public async subscribe(
    name: string,
    callback: SubscribeCallback,
  ): Promise<UnSubscribeFn> {
    const topic = this.prefix(name);
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
