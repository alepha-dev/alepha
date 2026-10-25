import { $inject, Alepha, type ZType } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import {
  DateTimeProvider,
  type DurationLike,
  type Timeout,
} from "alepha/datetime";
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
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * Requests waiting for their reply, by correlation id.
   */
  protected readonly pendingReplies = new Map<string, TopicPendingReply>();

  /**
   * The subscription to this instance's reply channel, opened by the first
   * request.
   */
  protected replySubscription: Promise<unknown> | undefined;

  protected cachedInstanceId: string | undefined;

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
      this.encodeMessage(schema, payload, options?.reply),
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
    return {
      payload: this.decodeMessage(schema, message),
    } as TopicMessage<T>;
  }

  /**
   * The bytes a typed payload travels as: `{ "payload": ... }` in JSON by
   * default, which is what the memory and Redis providers send.
   *
   * Override it, with `decodeMessage`, when the wire format is someone
   * else's contract: `MqttTopicProvider` sends the payload alone, as the
   * devices on the other end expect. `publishMessage`, `subscribeHandler`
   * and `waitForMessage` all go through the pair, so a `wait()` cannot read
   * a message differently from a `$subscriber`.
   *
   * `reply` is the request/response address. The envelope carries it as
   * `replyTo` and `correlationId` (see `decodeMeta`); a transport with
   * properties of its own (MQTT 5) carries it there and ignores it here.
   */
  protected encodeMessage<T extends TopicMessageSchema>(
    schema: T["payload"],
    payload: TopicMessage<T>["payload"],
    reply?: TopicMessageMeta,
  ): string {
    return JSON.stringify({
      payload: this.alepha.codec.encode(schema, payload),
      ...(reply?.replyTo !== undefined ? { replyTo: reply.replyTo } : {}),
      ...(reply?.correlationData !== undefined
        ? { correlationId: this.correlationKey(reply.correlationData) }
        : {}),
    });
  }

  /**
   * The request/response address of a raw message, from the envelope:
   * undefined for a plain publish. A provider whose transport carries it
   * (MQTT 5 Response Topic and Correlation Data) hands it to the subscribe
   * callback instead, and returns undefined here.
   */
  protected decodeMeta(raw: string): TopicMessageMeta | undefined {
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return undefined;
    }

    if (typeof envelope !== "object" || envelope === null) {
      return undefined;
    }

    const { replyTo, correlationId } = envelope as Record<string, unknown>;
    const meta: TopicMessageMeta = {
      replyTo: typeof replyTo === "string" ? replyTo : undefined,
      correlationData:
        typeof correlationId === "string" ? correlationId : undefined,
    };

    if (meta.replyTo === undefined && meta.correlationData === undefined) {
      return undefined;
    }

    return meta;
  }

  /**
   * The inverse of `encodeMessage`. A message it cannot decode throws, and
   * is logged and dropped by the caller.
   */
  protected decodeMessage<T extends TopicMessageSchema>(
    schema: T["payload"],
    raw: string,
  ): TopicMessage<T>["payload"] {
    const { payload } = JSON.parse(raw);
    return this.alepha.codec.decode(
      schema,
      payload,
    ) as TopicMessage<T>["payload"];
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
      async (message, receivedTopic?: string, transportMeta?) => {
        try {
          const parsed = this.parseMessage<T>(schema, message);
          const meta = transportMeta ?? this.decodeMeta(message);

          if (parser.hasParams && receivedTopic) {
            const params = parser.extract(receivedTopic) ?? {};
            await handler({ ...parsed, params } as TopicMessage<T>, meta);
          } else {
            await handler(parsed, meta);
          }
        } catch (error) {
          this.log.error("Message processing has failed", error);
        }
      },
      options,
    );
  }

  /**
   * Publish a typed request and resolve with the typed reply.
   *
   * The request carries this instance's reply address and a fresh
   * correlation id; the responder (`TopicPrimitive.subscribe`, on a topic
   * with a `response` schema) answers through `replyMessage`. The first
   * reply settles the request, later ones are dropped at debug level.
   *
   * Runs under `DateTimeProvider.deadline()`: past `timeout` (default 10s)
   * it rejects with the 503 `TimeoutError`, and an ambient abort (a client
   * disconnect) rejects it with the abort's reason. Either way, and after a
   * reply, the pending entry is gone.
   */
  public async requestMessage<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    payload: TopicMessage<T>["payload"],
    responseSchema: ZType,
    options: TopicRequestMessageOptions = {},
  ): Promise<unknown> {
    await this.listenForReplies();
    const correlationId = this.crypto.randomUUID();

    return this.dateTimeProvider.deadline(
      async (signal) => {
        let onAbort: (() => void) | undefined;
        try {
          const reply = new Promise<unknown>((resolve, reject) => {
            onAbort = () => reject(signal.reason);
            this.pendingReplies.set(correlationId, {
              schema: responseSchema,
              resolve,
            });
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
          });
          // Awaited below, after the publish; this only keeps a rejection
          // that lands while the publish is still running from reading as
          // unhandled.
          reply.catch(() => undefined);

          await this.publishMessage<T>(name, schema, payload, {
            ...options.publish,
            reply: {
              replyTo: this.replyAddress(),
              correlationData: correlationId,
            },
          });

          return await reply;
        } finally {
          if (onAbort) {
            signal.removeEventListener("abort", onAbort);
          }
          this.pendingReplies.delete(correlationId);
        }
      },
      options.timeout ?? [10, "seconds"],
    );
  }

  /**
   * Answer a request: encode `value` with the response schema and send it
   * to the request's reply address, through `reply`. A message with no
   * reply address is a plain publish and gets nothing. A value the schema
   * refuses, or a send that fails, is logged and nothing is sent: the
   * requester times out.
   */
  public async replyMessage(
    schema: ZType,
    meta: TopicMessageMeta,
    value: unknown,
  ): Promise<void> {
    if (meta.replyTo === undefined) {
      return;
    }

    try {
      const encoded = this.encodeMessage(schema, value, {
        correlationData: meta.correlationData,
      });
      await this.reply(meta, encoded);
    } catch (error) {
      this.log.error(`Reply to '${meta.replyTo}' has failed`, error);
    }
  }

  /**
   * Send an encoded reply to a request's reply address. The address is
   * opaque to everyone but the provider that received the request; by
   * default it is a topic of this provider, published to as it is.
   */
  protected async reply(
    meta: TopicMessageMeta,
    encoded: string,
  ): Promise<void> {
    if (meta.replyTo === undefined) {
      return;
    }

    await this.publish(meta.replyTo, encoded, {
      reply: { correlationData: meta.correlationData },
    });
  }

  /**
   * One id per container, drawn once: it names this instance's reply
   * channel. The framework has no instance id of its own.
   */
  protected get instanceId(): string {
    this.cachedInstanceId ??= this.crypto.randomUUID();
    return this.cachedInstanceId;
  }

  /**
   * This instance's reply channel, as a topic of this provider:
   * `reply:<instance id>` (on Redis, `<alepha.name>:topic:reply:<id>` once
   * prefixed).
   */
  protected replyTopic(): string {
    return `reply:${this.instanceId}`;
  }

  /**
   * The address a request carries for its reply.
   */
  protected replyAddress(): string {
    return this.replyTopic();
  }

  /**
   * Open the reply channel once, on the first request: a plain
   * subscription, never in a shared group.
   */
  protected listenForReplies(): Promise<unknown> {
    this.replySubscription ??= this.subscribeReplies(
      (raw, _topic, transportMeta) => this.receiveReply(raw, transportMeta),
    ).catch((error: unknown) => {
      this.replySubscription = undefined;
      throw error;
    });

    return this.replySubscription;
  }

  /**
   * Subscribe to this instance's reply channel.
   */
  protected subscribeReplies(
    callback: SubscribeCallback,
  ): Promise<UnSubscribeFn> {
    return this.subscribe(this.replyTopic(), callback);
  }

  /**
   * Settle the request a reply answers. One with no pending request (late,
   * from a second responder, or after an abort) is dropped at debug level;
   * one that does not decode is logged and dropped, and the request keeps
   * waiting.
   */
  protected receiveReply(raw: string, transportMeta?: TopicMessageMeta): void {
    const meta = transportMeta ?? this.decodeMeta(raw);
    const key =
      meta?.correlationData === undefined
        ? undefined
        : this.correlationKey(meta.correlationData);
    const pending =
      key === undefined ? undefined : this.pendingReplies.get(key);

    if (key === undefined || !pending) {
      this.log.debug("Dropped a reply no request is waiting for", {
        correlationId: key,
      });
      return;
    }

    let value: unknown;
    try {
      value = this.decodeMessage(pending.schema, raw);
    } catch (error) {
      this.log.error("Reply processing has failed", error);
      return;
    }

    this.pendingReplies.delete(key);
    pending.resolve(value);
  }

  /**
   * A correlation id as a string, whichever form it travelled in.
   */
  protected correlationKey(data: string | Uint8Array): string {
    return typeof data === "string" ? data : new TextDecoder().decode(data);
  }

  /**
   * Wait for a single message matching an optional filter, with timeout.
   *
   * A templated name (`devices/{id}/status`) subscribes to its wildcard
   * form, like `subscribeHandler`, and the message handed to `filter` and
   * resolved carries the params of the topic it arrived on. It never joins
   * a shared group: a one-shot listener must not take messages from the
   * group's handlers.
   */
  public async waitForMessage<T extends TopicMessageSchema>(
    name: string,
    schema: T["payload"],
    options: TopicWaitOptions<T> = {},
  ): Promise<TopicMessage<T>> {
    const filter = options.filter ?? (() => true);
    const parser = new TemplatedPathParser(name);
    const subscribeTopic = parser.hasParams
      ? parser.wildcardize(this.wildcardChar())
      : name;

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
      //
      // Refed, deliberately, unlike the eviction and lock-expiry timers that
      // were unrefed for holding the process open. This callback is not
      // housekeeping: it is how a caller awaiting this promise learns that no
      // message came, and it is usually the only handle keeping the loop
      // alive (a memory subscription is a map insert and refs nothing).
      // Unrefed, a process whose last act is `await topic.wait(...)` would
      // exit at the await with no rejection and status 0.
      ref.timeout = this.dateTimeProvider.createTimeout(() => {
        settle(() =>
          reject(
            new TopicTimeoutError({
              topic: name,
              timeout: this.dateTimeProvider
                .duration(timeoutDuration)
                .asMilliseconds(),
            }),
          ),
        );
      }, timeoutDuration);

      void (async () => {
        try {
          const clear = await this.subscribe(
            subscribeTopic,
            (raw, receivedTopic?: string) => {
              let message: TopicMessage<T>;
              try {
                message = this.parseMessage<T>(schema, raw);
              } catch (error) {
                this.log.error("Message processing has failed", error);
                return;
              }

              if (parser.hasParams && receivedTopic) {
                message = {
                  ...message,
                  params: parser.extract(receivedTopic) ?? {},
                } as TopicMessage<T>;
              }

              if (!filter(message)) {
                return;
              }
              settle(() => resolve(message));
            },
          );

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
   * Returns the list of $subscribers for this provider, each with the name
   * of the topic it subscribes to.
   */
  protected subscribers(): Array<TopicSubscription> {
    const handlers: Array<TopicSubscription> = [];

    const topics = this.alepha.primitives($topic);

    for (const topic of topics) {
      if (topic.provider !== this) {
        continue;
      }

      const handler = topic.options.handler;
      if (handler) {
        handlers.push({
          name: topic.name,
          subscribe: () => topic.subscribe(handler),
        });
      }
    }

    const subscribers = this.alepha.primitives($subscriber);
    for (const subscriber of subscribers) {
      if (subscriber.options.topic.provider !== this) {
        continue;
      }

      const handler = subscriber.handler.run.bind(subscriber.handler);
      handlers.push({
        name: subscriber.options.topic.name,
        subscribe: () => subscriber.options.topic.subscribe(handler),
      });
    }

    return handlers;
  }
}

/**
 * One declared subscription: the topic it targets and how to open it.
 */
export interface TopicSubscription {
  name: string;
  subscribe: () => Promise<unknown>;
}

export type SubscribeCallback = (
  message: string,
  topic?: string,
  meta?: TopicMessageMeta,
) => Promise<void> | void;

/**
 * What a request carries besides its payload: where to reply, and what to
 * reply with so the requester recognises the answer. Opaque to the
 * primitive: the provider that received the request is the one that reads
 * it (`TopicProvider.reply`).
 */
export interface TopicMessageMeta {
  /**
   * The reply address: a topic of the provider, or on MQTT the Response
   * Topic, verbatim.
   */
  replyTo?: string;

  /**
   * The correlation id, or on MQTT the Correlation Data as received.
   */
  correlationData?: string | Uint8Array;
}

/**
 * A request waiting for its reply.
 */
export interface TopicPendingReply {
  schema: ZType;
  resolve: (value: unknown) => void;
}

export interface TopicRequestMessageOptions {
  /**
   * How long to wait for the reply.
   *
   * @default [10, "seconds"]
   */
  timeout?: DurationLike;

  /**
   * Options of the request's publish (params, provider options).
   */
  publish?: TopicPublishOptions;
}

export type UnSubscribeFn = () => Promise<void>;

export interface TopicPublishOptions {
  retain?: boolean;
  params?: Record<string, string>;

  /**
   * The request/response address this message carries: `request()` sets
   * it, and a reply carries its correlation id.
   */
  reply?: TopicMessageMeta;
}

// Left open for a provider module to augment with its own options.
export interface TopicSubscribeOptions {}
