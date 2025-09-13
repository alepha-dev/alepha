import {
	$inject,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	type Static,
	type TSchema,
} from "@alepha/core";
import {
	DateTimeProvider,
	type DurationLike,
	type Timeout,
} from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { TopicTimeoutError } from "../errors/TopicTimeoutError.ts";
import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import {
	TopicProvider,
	type UnSubscribeFn,
} from "../providers/TopicProvider.ts";

/**
 * Creates a topic descriptor for pub/sub messaging and event-driven architecture.
 *
 * This descriptor provides a powerful publish/subscribe system that enables decoupled communication
 * between different parts of your application. Topics allow multiple publishers to send messages
 * and multiple subscribers to receive them, creating flexible event-driven architectures with
 * support for real-time messaging and asynchronous event processing.
 *
 * **Key Features**
 *
 * - **Publish/Subscribe Pattern**: Decoupled communication between publishers and subscribers
 * - **Multiple Subscribers**: One-to-many message distribution with automatic fan-out
 * - **Type-Safe Messages**: Full TypeScript support with schema validation using TypeBox
 * - **Real-time Processing**: Immediate message delivery to active subscribers
 * - **Event Filtering**: Subscribe to specific message types using filter functions
 * - **Timeout Support**: Wait for specific messages with configurable timeouts
 * - **Multiple Backends**: Support for in-memory, Redis, and custom topic providers
 * - **Error Resilience**: Built-in error handling and message processing recovery
 *
 * **Use Cases**
 *
 * Perfect for event-driven architectures and real-time communication:
 * - User activity notifications
 * - Real-time chat and messaging systems
 * - System event broadcasting
 * - Microservice communication
 * - Live data updates and synchronization
 * - Application state change notifications
 * - Webhook and external API event handling
 *
 * @example
 * **Basic topic with publish/subscribe:**
 * ```ts
 * import { $topic } from "@alepha/topic";
 * import { t } from "@alepha/core";
 *
 * class NotificationService {
 *   userActivity = $topic({
 *     name: "user-activity",
 *     schema: {
 *       payload: t.object({
 *         userId: t.string(),
 *         action: t.union([t.literal("login"), t.literal("logout"), t.literal("purchase")]),
 *         timestamp: t.number(),
 *         metadata: t.optional(t.record(t.string(), t.any()))
 *       })
 *     },
 *     handler: async (message) => {
 *       // This subscriber runs automatically for all messages
 *       console.log(`User ${message.payload.userId} performed ${message.payload.action}`);
 *     }
 *   });
 *
 *   async trackUserLogin(userId: string) {
 *     // Publish event - all subscribers will receive it
 *     await this.userActivity.publish({
 *       userId,
 *       action: "login",
 *       timestamp: Date.now(),
 *       metadata: { source: "web", ip: "192.168.1.1" }
 *     });
 *   }
 *
 *   async setupAdditionalSubscriber() {
 *     // Add another subscriber dynamically
 *     await this.userActivity.subscribe(async (message) => {
 *       if (message.payload.action === "purchase") {
 *         await this.sendPurchaseConfirmation(message.payload.userId);
 *       }
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Real-time chat system with multiple subscribers:**
 * ```ts
 * class ChatService {
 *   messagesTopic = $topic({
 *     name: "chat-messages",
 *     description: "Real-time chat messages for all rooms",
 *     schema: {
 *       payload: t.object({
 *         messageId: t.string(),
 *         roomId: t.string(),
 *         userId: t.string(),
 *         content: t.string(),
 *         timestamp: t.number(),
 *         messageType: t.union([t.literal("text"), t.literal("image"), t.literal("file")])
 *       })
 *     }
 *   });
 *
 *   async sendMessage(roomId: string, userId: string, content: string) {
 *     await this.messagesTopic.publish({
 *       messageId: generateId(),
 *       roomId,
 *       userId,
 *       content,
 *       timestamp: Date.now(),
 *       messageType: "text"
 *     });
 *   }
 *
 *   // Different services can subscribe to the same topic
 *   async setupMessageLogging() {
 *     await this.messagesTopic.subscribe(async (message) => {
 *       // Log all messages for compliance
 *       await this.auditLogger.log({
 *         action: "message_sent",
 *         roomId: message.payload.roomId,
 *         userId: message.payload.userId,
 *         timestamp: message.payload.timestamp
 *       });
 *     });
 *   }
 *
 *   async setupNotificationService() {
 *     await this.messagesTopic.subscribe(async (message) => {
 *       // Send push notifications to offline users
 *       const offlineUsers = await this.getOfflineUsersInRoom(message.payload.roomId);
 *       await this.sendPushNotifications(offlineUsers, {
 *         title: `New message in ${message.payload.roomId}`,
 *         body: message.payload.content
 *       });
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Event filtering and waiting for specific messages:**
 * ```ts
 * class OrderService {
 *   orderEvents = $topic({
 *     name: "order-events",
 *     schema: {
 *       payload: t.object({
 *         orderId: t.string(),
 *         status: t.union([
 *           t.literal("created"),
 *           t.literal("paid"),
 *           t.literal("shipped"),
 *           t.literal("delivered"),
 *           t.literal("cancelled")
 *         ]),
 *         timestamp: t.number(),
 *         data: t.optional(t.record(t.string(), t.any()))
 *       })
 *     }
 *   });
 *
 *   async processOrder(orderId: string) {
 *     // Publish order created event
 *     await this.orderEvents.publish({
 *       orderId,
 *       status: "created",
 *       timestamp: Date.now()
 *     });
 *
 *     // Wait for payment confirmation with timeout
 *     try {
 *       const paymentEvent = await this.orderEvents.wait({
 *         timeout: [5, "minutes"],
 *         filter: (message) =>
 *           message.payload.orderId === orderId &&
 *           message.payload.status === "paid"
 *       });
 *
 *       console.log(`Order ${orderId} was paid at ${paymentEvent.payload.timestamp}`);
 *
 *       // Continue with shipping...
 *       await this.initiateShipping(orderId);
 *
 *     } catch (error) {
 *       if (error instanceof TopicTimeoutError) {
 *         console.log(`Payment timeout for order ${orderId}`);
 *         await this.cancelOrder(orderId);
 *       }
 *     }
 *   }
 *
 *   async setupOrderTracking() {
 *     // Subscribe only to shipping events
 *     await this.orderEvents.subscribe(async (message) => {
 *       if (message.payload.status === "shipped") {
 *         await this.updateTrackingInfo(message.payload.orderId, message.payload.data);
 *         await this.notifyCustomer(message.payload.orderId, "Your order has shipped!");
 *       }
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Redis-backed topic for distributed systems:**
 * ```ts
 * class DistributedEventSystem {
 *   systemEvents = $topic({
 *     name: "system-events",
 *     provider: RedisTopicProvider,  // Use Redis for cross-service communication
 *     schema: {
 *       payload: t.object({
 *         eventType: t.string(),
 *         serviceId: t.string(),
 *         data: t.record(t.string(), t.any()),
 *         timestamp: t.number(),
 *         correlationId: t.optional(t.string())
 *       })
 *     },
 *     handler: async (message) => {
 *       // Central event handler for all system events
 *       await this.processSystemEvent(message.payload);
 *     }
 *   });
 *
 *   async publishServiceHealth(serviceId: string, healthy: boolean) {
 *     await this.systemEvents.publish({
 *       eventType: "service.health",
 *       serviceId,
 *       data: { healthy, checkedAt: new Date().toISOString() },
 *       timestamp: Date.now()
 *     });
 *   }
 *
 *   async setupHealthMonitoring() {
 *     await this.systemEvents.subscribe(async (message) => {
 *       if (message.payload.eventType === "service.health") {
 *         await this.updateServiceStatus(
 *           message.payload.serviceId,
 *           message.payload.data.healthy
 *         );
 *
 *         if (!message.payload.data.healthy) {
 *           await this.alertOnCall(`Service ${message.payload.serviceId} is down`);
 *         }
 *       }
 *     });
 *   }
 * }
 * ```
 */
export const $topic = <T extends TopicMessageSchema>(
	options: TopicDescriptorOptions<T>,
): TopicDescriptor<T> => {
	return createDescriptor(TopicDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicDescriptorOptions<T extends TopicMessageSchema> {
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
	 * TypeBox schema defining the structure of messages published to this topic.
	 *
	 * The schema must include:
	 * - **payload**: Required schema for the main message data
	 * - **headers**: Optional schema for message metadata
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
	 *   payload: t.object({
	 *     eventId: t.string(),
	 *     eventType: t.union([t.literal("created"), t.literal("updated")]),
	 *     data: t.record(t.string(), t.any()),
	 *     timestamp: t.number(),
	 *     userId: t.optional(t.string())
	 *   }),
	 *   headers: t.optional(t.object({
	 *     source: t.string(),
	 *     correlationId: t.string()
	 *   }))
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
	 * @param message - The topic message with validated payload and headers
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
}

// ---------------------------------------------------------------------------------------------------------------------

export class TopicDescriptor<T extends TopicMessageSchema> extends Descriptor<
	TopicDescriptorOptions<T>
> {
	protected readonly log = $logger();
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	public readonly provider = this.$provider();

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	public async publish(payload: TopicMessage<T>["payload"]): Promise<void> {
		await this.provider.publish(
			this.name,
			JSON.stringify({
				payload: this.alepha.parse(this.options.schema.payload, payload),
			}),
		);
	}

	public async subscribe(handler: TopicHandler<T>): Promise<UnSubscribeFn> {
		return this.provider.subscribe(this.name, async (message) => {
			try {
				await handler(this.parseMessage(message));
			} catch (error) {
				this.log.error("Message processing has failed", error);
			}
		});
	}

	public async wait(
		options: TopicWaitOptions<T> = {},
	): Promise<TopicMessage<T>> {
		const filter = options.filter ?? (() => true);

		return new Promise((resolve, reject) => {
			const ref: { timeout?: Timeout } = {};

			(async () => {
				const clear = await this.provider.subscribe(this.name, (raw) => {
					const message = this.parseMessage(raw);
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
							this.name,
							this.dateTimeProvider.duration(timeoutDuration).asMilliseconds(),
						),
					);
				}, timeoutDuration);
			})();
		});
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

	protected parseMessage(message: string): TopicMessage<T> {
		const { payload } = JSON.parse(message);
		return {
			payload: this.alepha.parse(this.options.schema.payload, payload),
		};
	}
}

$topic[KIND] = TopicDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicMessage<T extends TopicMessageSchema> {
	payload: Static<T["payload"]>;
}

export interface TopicWaitOptions<T extends TopicMessageSchema> {
	timeout?: DurationLike;
	filter?: (message: { payload: Static<T["payload"]> }) => boolean;
}

export interface TopicMessageSchema {
	headers?: TSchema;
	payload: TSchema;
}

export type TopicHandler<T extends TopicMessageSchema = TopicMessageSchema> = (
	message: TopicMessage<T>,
) => unknown;
