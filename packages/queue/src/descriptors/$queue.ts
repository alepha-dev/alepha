import {
	$inject,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	type Static,
	type TSchema,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import { MemoryQueueProvider } from "../providers/MemoryQueueProvider.ts";
import { QueueProvider } from "../providers/QueueProvider.ts";
import { WorkerProvider } from "../providers/WorkerProvider.ts";

/**
 * Creates a queue descriptor for asynchronous message processing with background workers.
 *
 * This descriptor provides a powerful message queue system that enables decoupled, asynchronous
 * communication between different parts of your application. It supports multiple storage backends,
 * type-safe message handling, and automatic worker processing with intelligent retry mechanisms.
 *
 * **Key Features**
 *
 * - **Type-Safe Messages**: Full TypeScript support with schema validation using TypeBox
 * - **Multiple Storage Backends**: Support for in-memory, Redis, and custom queue providers
 * - **Background Processing**: Automatic worker threads for message processing
 * - **Reliable Delivery**: Built-in retry mechanisms and error handling
 * - **Scalable Architecture**: Horizontal scaling support with distributed queue backends
 * - **Dead Letter Queues**: Failed message handling with configurable retry policies
 *
 * **Use Cases**
 *
 * Perfect for decoupling application components and handling asynchronous tasks:
 * - Background job processing
 * - Email and notification sending
 * - Image/file processing pipelines
 * - Event-driven architectures
 * - Microservice communication
 * - Long-running data operations
 *
 * @example
 * **Basic queue with automatic processing:**
 * ```ts
 * import { $queue } from "@alepha/queue";
 * import { t } from "@alepha/core";
 *
 * class NotificationService {
 *   emailQueue = $queue({
 *     name: "email-notifications",
 *     schema: t.object({
 *       to: t.string(),
 *       subject: t.string(),
 *       body: t.string(),
 *       priority: t.optional(t.union([t.literal("high"), t.literal("normal")]))
 *     }),
 *     handler: async (message) => {
 *       // This runs in a background worker
 *       await this.sendEmail(message.payload);
 *       console.log(`Email sent to ${message.payload.to}`);
 *     }
 *   });
 *
 *   async sendWelcomeEmail(userEmail: string) {
 *     // Push message to queue for background processing
 *     await this.emailQueue.push({
 *       to: userEmail,
 *       subject: "Welcome to our platform!",
 *       body: "Thank you for joining us...",
 *       priority: "high"
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Batch processing with multiple messages:**
 * ```ts
 * class ImageProcessor {
 *   imageQueue = $queue({
 *     name: "image-processing",
 *     description: "Process uploaded images for optimization and thumbnails",
 *     schema: t.object({
 *       imageId: t.string(),
 *       originalUrl: t.string(),
 *       userId: t.string(),
 *       operations: t.array(t.union([
 *         t.literal("resize"),
 *         t.literal("compress"),
 *         t.literal("thumbnail")
 *       ]))
 *     }),
 *     handler: async (message) => {
 *       const { imageId, originalUrl, operations } = message.payload;
 *
 *       for (const operation of operations) {
 *         await this.processImage(imageId, originalUrl, operation);
 *       }
 *
 *       console.log(`Processed image ${imageId} with operations: ${operations.join(", ")}`);
 *     }
 *   });
 *
 *   async processUploadedImages(images: Array<{id: string; url: string; userId: string}>) {
 *     // Process multiple images in parallel
 *     const messages = images.map(img => ({
 *       imageId: img.id,
 *       originalUrl: img.url,
 *       userId: img.userId,
 *       operations: ["resize", "compress", "thumbnail"] as const
 *     }));
 *
 *     // Push all messages at once for efficient batch processing
 *     await this.imageQueue.push(...messages);
 *   }
 * }
 * ```
 *
 * @example
 * **Redis-backed queue for production scalability:**
 * ```ts
 * class OrderProcessor {
 *   orderQueue = $queue({
 *     name: "order-processing",
 *     provider: RedisQueueProvider,  // Use Redis for distributed processing
 *     schema: t.object({
 *       orderId: t.string(),
 *       customerId: t.string(),
 *       items: t.array(t.object({
 *         productId: t.string(),
 *         quantity: t.number(),
 *         price: t.number()
 *       })),
 *       paymentMethod: t.string(),
 *       shippingAddress: t.object({
 *         street: t.string(),
 *         city: t.string(),
 *         zipCode: t.string(),
 *         country: t.string()
 *       })
 *     }),
 *     handler: async (message) => {
 *       const { orderId, customerId, items } = message.payload;
 *
 *       // Process payment
 *       await this.processPayment(orderId, items);
 *
 *       // Update inventory
 *       await this.updateInventory(items);
 *
 *       // Send confirmation email
 *       await this.sendOrderConfirmation(customerId, orderId);
 *
 *       // Schedule shipping
 *       await this.scheduleShipping(orderId, message.payload.shippingAddress);
 *
 *       console.log(`Order ${orderId} processed successfully`);
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Memory-only queue for development and testing:**
 * ```ts
 * class DevTaskProcessor {
 *   taskQueue = $queue({
 *     name: "dev-tasks",
 *     provider: "memory",  // Use in-memory queue for development
 *     schema: t.object({
 *       taskType: t.union([t.literal("cleanup"), t.literal("backup"), t.literal("report")]),
 *       data: t.record(t.string(), t.any()),
 *       scheduledAt: t.optional(t.string())
 *     }),
 *     handler: async (message) => {
 *       const { taskType, data } = message.payload;
 *
 *       switch (taskType) {
 *         case "cleanup":
 *           await this.performCleanup(data);
 *           break;
 *         case "backup":
 *           await this.createBackup(data);
 *           break;
 *         case "report":
 *           await this.generateReport(data);
 *           break;
 *       }
 *     }
 *   });
 * }
 * ```
 */
export const $queue = <T extends TSchema>(
	options: QueueDescriptorOptions<T>,
): QueueDescriptor<T> => {
	return createDescriptor(QueueDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueDescriptorOptions<T extends TSchema> {
	/**
	 * Unique name for the queue.
	 *
	 * This name is used for:
	 * - Queue identification across the system
	 * - Storage backend key generation
	 * - Logging and monitoring
	 * - Worker assignment and routing
	 *
	 * If not provided, defaults to the property key where the queue is declared.
	 *
	 * @example "email-notifications"
	 * @example "image-processing"
	 * @example "order-fulfillment"
	 */
	name?: string;

	/**
	 * Human-readable description of the queue's purpose.
	 *
	 * Used for:
	 * - Documentation generation
	 * - Monitoring dashboards
	 * - Development team communication
	 * - Queue management interfaces
	 *
	 * @example "Process user registration emails and welcome sequences"
	 * @example "Handle image uploads, resizing, and thumbnail generation"
	 * @example "Manage order processing, payment, and shipping workflows"
	 */
	description?: string;

	/**
	 * Queue storage provider configuration.
	 *
	 * Options:
	 * - **"memory"**: In-memory queue (default for development, lost on restart)
	 * - **Service<QueueProvider>**: Custom provider class (e.g., RedisQueueProvider)
	 * - **undefined**: Uses the default queue provider from dependency injection
	 *
	 * **Provider Selection Guidelines**:
	 * - Development: Use "memory" for fast, simple testing
	 * - Production: Use Redis or database-backed providers for persistence
	 * - High-throughput: Use specialized providers with connection pooling
	 * - Distributed systems: Use Redis or message brokers for scalability
	 *
	 * @default Uses injected QueueProvider
	 * @example "memory"
	 * @example RedisQueueProvider
	 * @example DatabaseQueueProvider
	 */
	provider?: "memory" | Service<QueueProvider>;

	/**
	 * TypeBox schema defining the structure of messages in this queue.
	 *
	 * This schema:
	 * - Validates all messages pushed to the queue
	 * - Provides full TypeScript type inference
	 * - Ensures type safety between producers and consumers
	 * - Enables automatic serialization/deserialization
	 *
	 * **Schema Design Best Practices**:
	 * - Keep schemas simple and focused on the specific task
	 * - Use optional fields for data that might not always be available
	 * - Include version fields for schema evolution
	 * - Use union types for different message types in the same queue
	 *
	 * @example
	 * ```ts
	 * t.object({
	 *   userId: t.string(),
	 *   action: t.union([t.literal("create"), t.literal("update")]),
	 *   data: t.record(t.string(), t.any()),
	 *   timestamp: t.optional(t.number())
	 * })
	 * ```
	 */
	schema: T;

	/**
	 * Message handler function that processes queue messages.
	 *
	 * This function:
	 * - Runs in background worker threads for non-blocking processing
	 * - Receives type-safe message payloads based on the schema
	 * - Should be idempotent to handle potential retries
	 * - Can throw errors to trigger retry mechanisms
	 * - Has access to the full Alepha dependency injection container
	 *
	 * **Handler Best Practices**:
	 * - Keep handlers focused on a single responsibility
	 * - Use proper error handling and logging
	 * - Make operations idempotent when possible
	 * - Validate critical business logic within handlers
	 * - Consider using transactions for data consistency
	 *
	 * @param message - The queue message with validated payload
	 * @returns Promise that resolves when processing is complete
	 *
	 * @example
	 * ```ts
	 * handler: async (message) => {
	 *   const { userId, email, template } = message.payload;
	 *
	 *   try {
	 *     await this.emailService.send({
	 *       to: email,
	 *       template,
	 *       data: { userId }
	 *     });
	 *
	 *     await this.userService.markEmailSent(userId, template);
	 *   } catch (error) {
	 *     // Log error and let the queue system handle retries
	 *     this.logger.error(`Failed to send email to ${email}`, error);
	 *     throw error;
	 *   }
	 * }
	 * ```
	 */
	handler?: (message: QueueMessage<T>) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class QueueDescriptor<T extends TSchema> extends Descriptor<
	QueueDescriptorOptions<T>
> {
	protected readonly log = $logger();
	protected readonly workerProvider = $inject(WorkerProvider);
	public readonly provider = this.$provider();

	public async push(...payloads: Array<Static<T>>) {
		await Promise.all(
			payloads.map((payload) =>
				this.provider.push(
					this.name,
					JSON.stringify({
						headers: {},
						payload: this.alepha.parse(this.options.schema, payload),
					}),
				),
			),
		);

		this.log.debug(`Pushed to queue ${this.name}`, payloads);
		this.workerProvider.wakeUp();
	}

	public get name() {
		return this.options.name || this.config.propertyKey;
	}

	protected $provider() {
		if (!this.options.provider) {
			return this.alepha.inject(QueueProvider);
		}
		if (this.options.provider === "memory") {
			return this.alepha.inject(MemoryQueueProvider);
		}
		return this.alepha.inject(this.options.provider);
	}
}

$queue[KIND] = QueueDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueMessageSchema {
	payload: TSchema;
}

export interface QueueMessage<T extends TSchema> {
	payload: Static<T>;
}
