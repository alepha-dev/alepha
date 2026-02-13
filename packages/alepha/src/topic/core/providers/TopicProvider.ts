import { $inject, Alepha } from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { TopicTimeoutError } from "../errors/TopicTimeoutError.ts";
import { $subscriber } from "../primitives/$subscriber.ts";
import {
  $topic,
  type TopicHandler,
  type TopicMessage,
  type TopicMessageSchema,
  type TopicWaitOptions,
} from "../primitives/$topic.ts";

/**
 * Base class for topic providers.
 */
export abstract class TopicProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  /**
   * Publish a raw message to a topic.
   *
   * @param topic - The topic to publish to.
   * @param message - The message to publish.
   */
  public abstract publish(topic: string, message: string): Promise<void>;

  /**
   * Subscribe to a topic with a raw callback.
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
   * Encode and publish a typed message to a topic.
   */
  public async publishMessage<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    payload: TopicMessage<T>["payload"],
  ): Promise<void> {
    await this.publish(
      name,
      JSON.stringify({
        payload: this.alepha.codec.encode(schema, payload),
      }),
    );
  }

  /**
   * Parse a raw message string into a typed topic message.
   */
  public parseMessage<T extends TopicMessageSchema>(
    schema: T["payload"],
    message: string,
  ): TopicMessage<T> {
    const { payload } = JSON.parse(message);
    return {
      payload: this.alepha.codec.decode(
        schema,
        payload,
      ) as TopicMessage<T>["payload"],
    };
  }

  /**
   * Subscribe a typed handler to a topic, with error wrapping and message parsing.
   */
  public async subscribeHandler<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    handler: TopicHandler<T>,
  ): Promise<UnSubscribeFn> {
    return this.subscribe(name, async (message) => {
      try {
        await handler(this.parseMessage<T>(schema, message));
      } catch (error) {
        this.log.error("Message processing has failed", error);
      }
    });
  }

  /**
   * Wait for a single message matching an optional filter, with timeout.
   */
  public async waitForMessage<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    options: TopicWaitOptions<T> = {},
  ): Promise<TopicMessage<T>> {
    const filter = options.filter ?? (() => true);

    return new Promise((resolve, reject) => {
      const ref: { timeout?: Timeout } = {};

      (async () => {
        const clear = await this.subscribe(name, (raw) => {
          const message = this.parseMessage<T>(schema, raw);
          if (!filter(message)) {
            return;
          }

          ref.timeout?.clear();
          clear();
          resolve(message);
        });

        const timeoutDuration = options.timeout ?? [10, "seconds"];

        ref.timeout = this.dateTimeProvider.createTimeout(() => {
          clear();
          reject(
            new TopicTimeoutError(
              name,
              this.dateTimeProvider.duration(timeoutDuration).asMilliseconds(),
            ),
          );
        }, timeoutDuration);
      })();
    });
  }

  /**
   * Returns the list of $subscribers for this provider.
   */
  protected subscribers(): Array<() => Promise<unknown>> {
    const handlers: Array<() => Promise<unknown>> = [];

    const topics = this.alepha.primitives($topic);

    for (const topic of topics) {
      if (topic.provider !== this) {
        continue;
      }

      const handler = topic.options.handler;
      if (handler && topic.provider === this) {
        handlers.push(() => topic.subscribe(handler));
      }
    }

    const subscribers = this.alepha.primitives($subscriber);
    for (const subscriber of subscribers) {
      if (subscriber.options.topic.provider !== this) {
        continue;
      }

      const handler = subscriber.handler.run.bind(subscriber.handler);
      handlers.push(() => subscriber.options.topic.subscribe(handler));
    }

    return handlers;
  }
}

export type SubscribeCallback = (message: string) => Promise<void> | void;

export type UnSubscribeFn = () => Promise<void>;
