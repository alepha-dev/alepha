import { $hook } from "alepha";
import { $logger } from "alepha/logger";

import {
  type SubscribeCallback,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "./TopicProvider.ts";

export class MemoryTopicProvider extends TopicProvider {
  protected readonly log = $logger();
  protected readonly subscriptions: Record<string, SubscribeCallback[]> = {};
  protected readonly retained: Record<string, string> = {};

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

  /**
   * Publish a message to a topic.
   *
   * @param topic
   * @param message
   * @param options
   */
  public async publish(
    topic: string,
    message: string,
    options?: TopicPublishOptions,
  ): Promise<void> {
    if (options?.retain) {
      this.retained[topic] = message;
    }

    for (const [pattern, callbacks] of Object.entries(this.subscriptions)) {
      if (this.topicMatches(pattern, topic)) {
        for (const callback of callbacks) {
          await callback(message, topic);
        }
      }
    }
  }

  /**
   * Subscribe to a topic.
   *
   * @param topic - The topic to subscribe to.
   * @param callback
   */

  public async subscribe(
    topic: string,
    callback: SubscribeCallback,
    _options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    if (!this.subscriptions[topic]) {
      this.subscriptions[topic] = [];
    }

    this.subscriptions[topic].push(callback);

    // Deliver retained messages matching the pattern
    for (const [retainedTopic, retainedMessage] of Object.entries(
      this.retained,
    )) {
      if (this.topicMatches(topic, retainedTopic)) {
        await callback(retainedMessage, retainedTopic);
      }
    }

    return async () => {
      const callbacks = this.subscriptions[topic];
      if (!callbacks) {
        return;
      }

      this.subscriptions[topic] = callbacks.filter((cb) => cb !== callback);
      if (this.subscriptions[topic].length === 0) {
        delete this.subscriptions[topic];
      }
    };
  }

  /**
   * Unsubscribe from a topic.
   *
   * @param topic - The topic to unsubscribe from.
   */
  public async unsubscribe(topic: string): Promise<void> {
    delete this.subscriptions[topic];
  }

  /**
   * Check if a topic matches a subscription pattern.
   * Supports `+` single-level wildcard.
   */
  protected topicMatches(pattern: string, topic: string): boolean {
    if (pattern === topic) {
      return true;
    }

    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    if (patternParts.length !== topicParts.length) {
      return false;
    }

    return patternParts.every(
      (part, i) => part === "+" || part === topicParts[i],
    );
  }
}
