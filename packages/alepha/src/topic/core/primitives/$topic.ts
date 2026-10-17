import {
  AlephaError,
  createPrimitive,
  type Infer,
  Primitive,
  type Service,
  type ZType,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import { KIND } from "alepha/internal";

import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import {
  type TopicMessageMeta,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "../providers/TopicProvider.ts";

/**
 * Creates a topic primitive for publish/subscribe messaging and event-driven architecture.
 *
 * Enables decoupled communication through a pub/sub pattern where publishers send messages
 * and multiple subscribers receive them. Supports type-safe messages, real-time delivery,
 * event filtering, and pluggable backends (memory, Redis, custom providers).
 *
 * **Use Cases**: User notifications, real-time chat, event broadcasting, microservice communication
 *
 * @example
 * ```ts
 * class NotificationService {
 *   dateTime = $inject(DateTimeProvider);
 *
 *   userActivity = $topic({
 *     name: "user-activity",
 *     schema: {
 *       payload: z.object({
 *         userId: z.text(),
 *         action: z.enum(["login", "logout", "purchase"]),
 *         timestamp: z.number()
 *       })
 *     },
 *     handler: async (message) => {
 *       console.log(`User ${message.payload.userId}: ${message.payload.action}`);
 *     }
 *   });
 *
 *   async trackLogin(userId: string) {
 *     await this.userActivity.publish({ userId, action: "login", timestamp: this.dateTime.nowMillis() });
 *   }
 *
 *   async subscribeToEvents() {
 *     await this.userActivity.subscribe(async (message) => {
 *       // Additional subscriber logic
 *     });
 *   }
 * }
 * ```
 */
export const $topic = <T extends TopicMessageSchema>(
  options: TopicPrimitiveOptions<T>,
): TopicPrimitive<T> => {
  return createPrimitive(TopicPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicPrimitiveOptions<T extends TopicMessageSchema> {
  /**
   * Unique name identifier for the topic.
   *
   * This name is used for:
   * - Topic identification across the pub/sub system
   * - Message routing between publishers and subscribers
   * - Logging and debugging topic-related operations
   * - Provider-specific topic management (channels, keys, etc.)
   *
   * If not provided, defaults to the property key where the topic is declared.
   *
   * **Naming Conventions**:
   * - Use descriptive, hierarchical names: "user.activity", "order.events"
   * - Avoid spaces and special characters
   * - Consider using dot notation for categorization
   * - Keep names concise but meaningful
   *
   * @example "user-activity"
   * @example "chat.messages"
   * @example "system.health.checks"
   * @example "payment.webhooks"
   */
  name?: string;

  /**
   * Human-readable description of the topic's purpose and usage.
   *
   * Used for:
   * - Documentation generation and API references
   * - Developer onboarding and understanding
   * - Monitoring dashboards and admin interfaces
   * - Team communication about system architecture
   *
   * **Description Best Practices**:
   * - Explain what events/messages this topic handles
   * - Mention key use cases and subscribers
   * - Include any important timing or ordering guarantees
   * - Note any special processing requirements
   *
   * @example "Real-time user activity events for analytics and notifications"
   * @example "Order lifecycle events from creation to delivery"
   * @example "Chat messages broadcast to all room participants"
   * @example "System health checks and service status updates"
   */
  description?: string;

  /**
   * Topic provider configuration for message storage and delivery.
   *
   * Options:
   * - **"memory"**: In-memory provider (default for development, lost on restart)
   * - **Service<TopicProvider>**: Custom provider class (e.g., RedisTopicProvider)
   * - **undefined**: Uses the default topic provider from dependency injection
   *
   * **Provider Selection Guidelines**:
   * - **Development**: Use "memory" for fast, simple testing without external dependencies
   * - **Production**: Use Redis or message brokers for persistence and scalability
   * - **Distributed systems**: Use Redis/RabbitMQ for cross-service communication
   * - **High-throughput**: Use specialized providers with connection pooling
   * - **Real-time**: Ensure provider supports low-latency message delivery
   *
   * **Provider Capabilities**:
   * - Message persistence and durability
   * - Subscriber management and connection handling
   * - Message ordering and delivery guarantees
   * - Horizontal scaling and load distribution
   *
   * @default Uses injected TopicProvider
   * @example "memory"
   * @example RedisTopicProvider
   */
  provider?: "memory" | Service<TopicProvider>;

  /**
   * Zod schema defining the structure of messages published to this topic.
   *
   * The schema must include:
   * - **payload**: Required schema for the main message data
   * - **params**: Optional schema for message parameters
   *
   * This schema:
   * - Validates all messages published to the topic
   * - Provides full TypeScript type inference for subscribers
   * - Ensures type safety between publishers and subscribers
   * - Enables automatic serialization/deserialization
   *
   * **Schema Design Best Practices**:
   * - Keep payload schemas focused and cohesive
   * - Use optional fields for data that might not always be present
   * - Include timestamp fields for event ordering
   * - Consider versioning for schema evolution
   * - Use union types for different event types in the same topic
   *
   * @example
   * ```ts
   * {
   *   payload: z.object({
   *     eventId: z.text(),
   *     eventType: z.enum(["created", "updated"]),
   *     data: z.record(z.text(), z.any()),
   *     timestamp: z.number(),
   *     userId: z.text().optional()
   *   }),
   *   params: z.object({
   *     source: z.text(),
   *     correlationId: z.text()
   *   }).optional()
   * }
   * ```
   */
  schema: T;

  /**
   * Default subscriber handler function that processes messages published to this topic.
   *
   * This handler:
   * - Automatically subscribes when the topic is initialized
   * - Receives all messages published to the topic
   * - Runs for every message without additional subscription setup
   * - Can be supplemented with additional subscribers via `subscribe()` method
   * - Should handle errors gracefully to avoid breaking other subscribers
   *
   * **Handler Design Guidelines**:
   * - Keep handlers focused on a single responsibility
   * - Use proper error handling and logging
   * - Consider performance impact for high-frequency topics
   * - Make handlers idempotent when possible
   * - Validate business rules within the handler logic
   * - Log important processing steps for debugging
   *
   * **Error Handling Strategy**:
   * - Log errors but don't re-throw to avoid affecting other subscribers
   * - Use try-catch blocks for external service calls
   * - Consider implementing circuit breakers for resilience
   * - Monitor error rates and patterns for system health
   *
   * @param message - The topic message with validated payload and params
   * @param message.payload - The typed message data based on the schema
   * @returns Promise that resolves when processing is complete
   *
   * @example
   * ```ts
   * handler: async (message) => {
   *   const { eventType, data, timestamp } = message.payload;
   *
   *   try {
   *     // Log message receipt
   *     this.logger.info(`Processing ${eventType} event`, { timestamp, data });
   *
   *     // Process based on event type
   *     switch (eventType) {
   *       case "created":
   *         await this.handleCreation(data);
   *         break;
   *       case "updated":
   *         await this.handleUpdate(data);
   *         break;
   *       default:
   *         this.logger.warn(`Unknown event type: ${eventType}`);
   *     }
   *
   *     this.logger.info(`Successfully processed ${eventType} event`);
   *
   *   } catch (error) {
   *     // Log error but don't re-throw to avoid affecting other subscribers
   *     this.logger.error(`Failed to process ${eventType} event`, {
   *       error: error.message,
   *       eventType,
   *       timestamp,
   *       data
   *     });
   *   }
   * }
   * ```
   */
  handler?: TopicHandler<T>;

  /**
   * Whether the last published message should be retained and delivered to new subscribers.
   *
   * When enabled, the provider stores the last message for this topic.
   * New subscribers immediately receive the retained message upon subscribing.
   *
   * Supported by the Memory, Redis and MQTT providers.
   *
   * @default false
   */
  retain?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class TopicPrimitive<T extends TopicMessageSchema> extends Primitive<
  TopicPrimitiveOptions<T>
> {
  public readonly provider = this.$provider();

  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  public async publish(message: TopicPublishMessage<T>): Promise<void> {
    const { payload, options } = this.split(message);
    await this.provider.publishMessage<T>(
      this.name,
      this.options.schema.payload,
      payload,
      { ...options, retain: this.options.retain },
    );
  }

  /**
   * Publish a request and resolve with the typed reply, on a topic whose
   * schema declares a `response`. The first argument is `publish()`'s.
   *
   * A responder is any `handler` or `$subscriber` of the topic: what it
   * returns is the reply. Past `timeout` (default 10s) it rejects with the
   * 503 `TimeoutError`, and a client disconnect (the ambient signal) aborts
   * it.
   *
   * ```ts
   * const result = await this.command.request(
   *   { params: { site, device }, payload: { action: "reboot" } },
   *   { timeout: [10, "seconds"] },
   * );
   * ```
   */
  public async request(
    this: TopicPrimitive<T & { response: ZType }>,
    message: TopicPublishMessage<T>,
    options: TopicRequestOptions = {},
  ): Promise<TopicResponse<T>> {
    const response = this.options.schema.response;
    if (!response) {
      // The `this:` type already refuses it; this is for untyped callers.
      throw new AlephaError(
        `Topic '${this.name}' has no response schema: request() needs one`,
      );
    }

    const { payload, options: publish } = this.split(message);
    return (await this.provider.requestMessage<T>(
      this.name,
      this.options.schema.payload,
      payload,
      response,
      { timeout: options.timeout, publish },
    )) as TopicResponse<T>;
  }

  /**
   * Subscribe a handler to the topic.
   *
   * On a topic with a `response` schema, the handler is also a responder:
   * when a message carries a reply address (it came from `request()`), what
   * the handler returns is encoded with the response schema and sent back.
   * A handler that throws, or returns what the schema refuses, sends
   * nothing.
   */
  public async subscribe(handler: TopicHandler<T>): Promise<UnSubscribeFn> {
    const response = this.options.schema.response;
    const responder: TopicHandler<T> = response
      ? async (message, meta) => {
          const result = await handler(message, meta);
          if (meta?.replyTo !== undefined) {
            await this.provider.replyMessage(response, meta, result);
          }
          return result;
        }
      : handler;

    return this.provider.subscribeHandler<T>(
      this.name,
      this.options.schema.payload,
      responder,
      // See `split`: the same merged options, on the subscribe side.
      { mqtt: (this.options as any).mqtt } as TopicSubscribeOptions,
    );
  }

  public async wait(
    options: TopicWaitOptions<T> = {},
  ): Promise<TopicMessage<T>> {
    return this.provider.waitForMessage<T>(
      this.name,
      this.options.schema.payload,
      options,
    );
  }

  /**
   * The payload and the publish options of a `publish()` or `request()`
   * argument: params live inside the message when the schema declares them.
   */
  protected split(message: TopicPublishMessage<T>): {
    payload: TopicMessage<T>["payload"];
    options: TopicPublishOptions;
  } {
    const hasParams = this.options.schema.params;
    return {
      payload: hasParams ? (message as any).payload : message,
      options: {
        params: hasParams ? (message as any).params : undefined,
        // Provider-specific options a module adds to this primitive by
        // declaration merging (`@alepha/mqtt/topic`: QoS, shared group).
        // Without it a per-topic QoS is silently ignored.
        mqtt: (this.options as any).mqtt,
      } as TopicPublishOptions,
    };
  }

  protected $provider(): TopicProvider {
    if (!this.options.provider) {
      return this.alepha.inject(TopicProvider);
    }

    if (this.options.provider === "memory") {
      return this.alepha.inject(MemoryTopicProvider);
    }

    return this.alepha.inject(this.options.provider);
  }
}

$topic[KIND] = TopicPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicMessage<T extends TopicMessageSchema> {
  payload: Infer<T["payload"]>;
  params: T extends { params: ZType } ? Infer<T["params"]> : never;
}

export interface TopicWaitOptions<T extends TopicMessageSchema> {
  timeout?: DurationLike;

  /**
   * Accept or skip a message. It carries the params of the topic it arrived
   * on, for a templated name.
   */
  filter?: (message: TopicMessage<T>) => boolean;
}

export interface TopicMessageSchema {
  payload: ZType;
  params?: ZType;

  /**
   * The reply's schema, for a topic used with `request()`: a handler's
   * return value is encoded with it and sent back to the requester.
   */
  response?: ZType;
}

/**
 * What `publish()` and `request()` take: the payload, or `{ params,
 * payload }` when the schema declares params.
 */
export type TopicPublishMessage<T extends TopicMessageSchema> = T extends {
  params: ZType;
}
  ? { params: Infer<T["params"]>; payload: TopicMessage<T>["payload"] }
  : TopicMessage<T>["payload"];

/**
 * What `request()` resolves: the topic's `response`.
 */
export type TopicResponse<T extends TopicMessageSchema> = T extends {
  response: ZType;
}
  ? Infer<T["response"]>
  : never;

export interface TopicRequestOptions {
  /**
   * How long to wait for the reply.
   *
   * @default [10, "seconds"]
   */
  timeout?: DurationLike;
}

/**
 * A topic handler. `meta` is the request/response address of a message that
 * came from `request()`, opaque to the handler.
 */
export type TopicHandler<T extends TopicMessageSchema = TopicMessageSchema> = (
  message: TopicMessage<T>,
  meta?: TopicMessageMeta,
) => unknown;
