import { $inject, Alepha } from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { TemplatedPathParser } from "alepha/router";
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
  public abstract publish(
    topic: string,
    message: string,
    options?: TopicPublishOptions,
  ): Promise<void>;

  /**
   * Subscribe to a topic with a raw callback.
   *
   * @param topic - The topic to subscribe to.
   * @param callback - The callback to call when a message is received.
   */
  public abstract subscribe(
    topic: string,
    callback: SubscribeCallback,
    options?: TopicSubscribeOptions,
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
    options?: TopicPublishOptions,
  ): Promise<void> {
    let topicName = name;
    if (options?.params) {
      const parser = new TemplatedPathParser(name);
      topicName = parser.interpolate(options.params);
    }

    await this.publish(
      topicName,
      JSON.stringify({
        payload: this.alepha.codec.encode(schema, payload),
      }),
      options,
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
    } as TopicMessage<T>;
  }

  /**
   * Subscribe a typed handler to a topic, with error wrapping and message parsing.
   */
  public async subscribeHandler<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    handler: TopicHandler<T>,
    options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const parser = new TemplatedPathParser(name);
    const subscribeTopic = parser.hasParams
      ? parser.wildcardize(this.wildcardChar())
      : name;

    return this.subscribe(
      subscribeTopic,
      async (message, receivedTopic?: string) => {
        try {
          const parsed = this.parseMessage<T>(schema, message);

          if (parser.hasParams && receivedTopic) {
            const params = parser.extract(receivedTopic) ?? {};
            await handler({ ...parsed, params } as TopicMessage<T>);
          } else {
            await handler(parsed);
          }
        } catch (error) {
          this.log.error("Message processing has failed", error);
        }
      },
      options,
    );
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

    const timeoutDuration = options.timeout ?? [10, "seconds"];

    return new Promise((resolve, reject) => {
      const ref: {
        timeout?: Timeout;
        clear?: () => unknown;
        settled?: boolean;
      } = {};

      const settle = (finish: () => void) => {
        if (ref.settled) {
          return;
        }
        ref.settled = true;
        ref.timeout?.clear();
        ref.clear?.();
        finish();
      };

      // Armed BEFORE subscribing. It used to be created only after
      // `subscribe` resolved, so a slow or hanging broker left the caller
      // with no deadline at all.
      ref.timeout = this.dateTimeProvider.createTimeout(() => {
        settle(() =>
          reject(
            new TopicTimeoutError(
              name,
              this.dateTimeProvider.duration(timeoutDuration).asMilliseconds(),
            ),
          ),
        );
      }, timeoutDuration);

      void (async () => {
        try {
          const clear = await this.subscribe(name, (raw) => {
            const message = this.parseMessage<T>(schema, raw);
            if (!filter(message)) {
              return;
            }
            settle(() => resolve(message));
          });

          ref.clear = clear;

          // A retained message can be delivered synchronously from inside
          // `subscribe`, i.e. before `clear` existed — unsubscribe now so the
          // subscription does not leak.
          if (ref.settled) {
            await clear();
          }
        } catch (error) {
          // Previously swallowed: neither resolve nor reject ran and the
          // caller awaited forever.
          settle(() => reject(error));
        }
      })();
    });
  }

  /**
   * The wildcard character used for pattern subscriptions.
   * Override in subclasses for provider-specific wildcards.
   */
  protected wildcardChar(): string {
    return "+";
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

export type SubscribeCallback = (
  message: string,
  topic?: string,
) => Promise<void> | void;

export type UnSubscribeFn = () => Promise<void>;

export interface TopicPublishOptions {
  retain?: boolean;
  params?: Record<string, string>;
}

// biome-ignore lint/suspicious/noEmptyInterface: augmented by provider-specific modules (e.g. MqttTopicProvider)
export interface TopicSubscribeOptions {}
