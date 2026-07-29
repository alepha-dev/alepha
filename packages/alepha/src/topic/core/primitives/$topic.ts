import {
  createPrimitive,
  KIND,
  Primitive,
  type Service,
  type Static,
  type TSchema,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import {
  TopicProvider,
  type TopicPublishOptions,
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
 *     await this.userActivity.publish({ userId, action: "login", timestamp: Date.now() });
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
   * @example RabbitMQTopicProvider
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
   * Supported by Memory, Redis, and MQTT providers.
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

  public async publish(
    message: T extends { params: TSchema }
      ? { params: Static<T["params"]>; payload: TopicMessage<T>["payload"] }
      : TopicMessage<T>["payload"],
  ): Promise<void> {
    const hasParams = this.options.schema.params;
    const payload = hasParams ? (message as any).payload : message;
    const params = hasParams ? (message as any).params : undefined;

    await this.provider.publishMessage<T>(
      this.name,
      this.options.schema.payload,
      payload,
      {
        retain: this.options.retain,
        mqtt: (this.options as any).mqtt,
        params,
      } as TopicPublishOptions,
    );
  }

  /**
   * `mqtt` is declaration-merged onto `TopicPrimitiveOptions` by
   * `@alepha/mqtt`, which core cannot import — an optional satellite must not
   * become a compile-time dependency of the module that declares the base
   * interface. Hence the cast: the field is real, core just cannot see it.
   */
  public async subscribe(handler: TopicHandler<T>): Promise<UnSubscribeFn> {
    return this.provider.subscribeHandler<T>(
      this.name,
      this.options.schema.payload,
      handler,
      { mqtt: (this.options as any).mqtt },
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
  payload: Static<T["payload"]>;
  params: T extends { params: TSchema } ? Static<T["params"]> : never;
}

export interface TopicWaitOptions<T extends TopicMessageSchema> {
  timeout?: DurationLike;
  filter?: (message: { payload: Static<T["payload"]> }) => boolean;
}

export interface TopicMessageSchema {
  payload: TSchema;
  params?: TSchema;
}

export type TopicHandler<T extends TopicMessageSchema = TopicMessageSchema> = (
  message: TopicMessage<T>,
) => unknown;
