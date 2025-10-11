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
 * The $queue descriptor enables powerful asynchronous communication patterns in your application.
 * It provides type-safe message queuing with automatic worker processing, making it perfect for
 * decoupling components and handling background tasks efficiently.
 *
 * **Background Processing**
 * - Automatic worker threads for non-blocking message processing
 * - Built-in retry mechanisms and error handling
 * - Dead letter queues for failed message handling
 * - Graceful shutdown and worker lifecycle management
 *
 * **Type Safety**
 * - Full TypeScript support with schema validation using TypeBox
 * - Type-safe message payloads with automatic inference
 * - Runtime validation of all queued messages
 * - Compile-time errors for invalid message structures
 *
 * **Storage Flexibility**
 * - Memory provider for development and testing
 * - Redis provider for production scalability and persistence
 * - Custom provider support for specialized backends
 * - Automatic failover and connection pooling
 *
 * **Performance & Scalability**
 * - Batch processing support for high-throughput scenarios
 * - Horizontal scaling with distributed queue backends
 * - Configurable concurrency and worker pools
 * - Efficient serialization and message routing
 *
 * **Reliability**
 * - Message persistence across application restarts
 * - Automatic retry with exponential backoff
 * - Dead letter handling for permanently failed messages
 * - Comprehensive logging and monitoring integration
 *
 * @example Basic notification queue
 * ```typescript
 * const emailQueue = $queue({
 *   name: "email-notifications",
 *   schema: t.object({
 *     to: t.text(),
 *     subject: t.text(),
 *     body: t.text(),
 *     priority: t.optional(t.enum(["high", "normal"]))
 *   }),
 *   handler: async (message) => {
 *     await emailService.send(message.payload);
 *     console.log(`Email sent to ${message.payload.to}`);
 *   }
 * });
 *
 * // Push messages for background processing
 * await emailQueue.push({
 *   to: "user@example.com",
 *   subject: "Welcome!",
 *   body: "Welcome to our platform",
 *   priority: "high"
 * });
 * ```
 *
 * @example Batch processing with Redis
 * ```typescript
 * const imageQueue = $queue({
 *   name: "image-processing",
 *   provider: RedisQueueProvider,
 *   schema: t.object({
 *     imageId: t.text(),
 *     operations: t.array(t.enum(["resize", "compress", "thumbnail"]))
 *   }),
 *   handler: async (message) => {
 *     for (const op of message.payload.operations) {
 *       await processImage(message.payload.imageId, op);
 *     }
 *   }
 * });
 *
 * // Batch processing multiple images
 * await imageQueue.push(
 *   { imageId: "img1", operations: ["resize", "thumbnail"] },
 *   { imageId: "img2", operations: ["compress"] },
 *   { imageId: "img3", operations: ["resize", "compress", "thumbnail"] }
 * );
 * ```
 *
 * @example Development with memory provider
 * ```typescript
 * const taskQueue = $queue({
 *   name: "dev-tasks",
 *   provider: "memory",
 *   schema: t.object({
 *     taskType: t.enum(["cleanup", "backup", "report"]),
 *     data: t.record(t.text(), t.any())
 *   }),
 *   handler: async (message) => {
 *     switch (message.payload.taskType) {
 *       case "cleanup":
 *         await performCleanup(message.payload.data);
 *         break;
 *       case "backup":
 *         await createBackup(message.payload.data);
 *         break;
 *       case "report":
 *         await generateReport(message.payload.data);
 *         break;
 *     }
 *   }
 * });
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
	 *   userId: t.text(),
	 *   action: t.enum(["create", "update"]),
	 *   data: t.record(t.text(), t.any()),
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
