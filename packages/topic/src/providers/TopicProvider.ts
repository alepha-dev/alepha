import { $inject, Alepha } from "@alepha/core";
import { $subscriber } from "../descriptors/$subscriber.ts";
import { $topic } from "../descriptors/$topic.ts";

/**
 * Base class for topic providers.
 */
export abstract class TopicProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Publish a message to a topic.
   *
   * @param topic - The topic to publish to.
   * @param message - The message to publish.
   */
  public abstract publish(topic: string, message: string): Promise<void>;

  /**
   * Subscribe to a topic.
   *
   * @param topic - The topic to subscribe to.
   * @param callback - The callback to call when a message is received.
   */
  public abstract subscribe(
    topic: string,
    callback: SubscribeCallback,
  ): Promise<UnSubscribeFn>;

  /**
   * Unsubscribe from a topic.
   *
   * @param topic - The topic to unsubscribe from.
   */
  public abstract unsubscribe(topic: string): Promise<void>;

  /**
   * Returns the list of $subscribers for this provider.
   */
  protected subscribers(): Array<() => Promise<unknown>> {
    const handlers: Array<() => Promise<unknown>> = [];

    const topics = this.alepha.descriptors($topic);

    for (const topic of topics) {
      if (topic.provider !== this) {
        continue;
      }

      const handler = topic.options.handler;
      if (handler && topic.provider === this) {
        handlers.push(() => topic.subscribe(handler));
      }
    }

    const subscribers = this.alepha.descriptors($subscriber);
    for (const subscriber of subscribers) {
      if (subscriber.options.topic.provider !== this) {
        continue;
      }

      handlers.push(() =>
        subscriber.options.topic.subscribe(subscriber.options.handler),
      );
    }

    return handlers;
  }
}

export type SubscribeCallback = (message: string) => Promise<void> | void;

export type UnSubscribeFn = () => Promise<void>;
