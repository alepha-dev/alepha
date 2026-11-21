import { $hook } from "alepha";

import {
  type SubscribeCallback,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "./TopicProvider.ts";

/**
 * Topics in memory, inside one container.
 *
 * The provider of an app with no `REDIS_URL`, and of tests: a message
 * reaches the subscribers of this instance only. A parameterized topic
 * matches one level per placeholder.
 */
export class MemoryTopicProvider extends TopicProvider {
  protected readonly subscriptions: Record<string, SubscribeCallback[]> = {};
  protected readonly retained: Record<string, string> = {};

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

  /**
   * Publish a message to a topic.
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
   * Subscribe to a topic. The returned function removes this subscription
   * and no other: a callback subscribed twice keeps its other registration,
   * and calling the function again does nothing.
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

    let subscribed = true;
    return async () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;

      const callbacks = this.subscriptions[topic];
      const index = callbacks?.indexOf(callback) ?? -1;
      if (!callbacks || index === -1) {
        return;
      }

      // A new array, never a splice: a callback may unsubscribe while
      // `publish` is iterating this one.
      this.subscriptions[topic] = callbacks.filter((_, i) => i !== index);
      if (this.subscriptions[topic].length === 0) {
        delete this.subscriptions[topic];
      }
    };
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
