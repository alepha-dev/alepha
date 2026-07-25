import {
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type Service,
  type Static,
  type TSchema,
} from "alepha";
import { $logger } from "alepha/logger";
import { MemoryQueueProvider } from "../providers/MemoryQueueProvider.ts";
import { QueueProvider } from "../providers/QueueProvider.ts";
import { WorkerProvider } from "../providers/WorkerProvider.ts";

/**
 * Creates a queue primitive for asynchronous message processing with background workers.
 *
 * `$queue` is the **raw transport layer**: it fans messages out to background
 * workers over the configured backend with type-safe payloads. Delivery is
 * **at-most-once** — a message is popped from the backend before the handler
 * runs, so a handler error or a process crash loses it. There is no retry,
 * no dead-letter queue, and no delivery guarantee at this layer.
 *
 * **For work that must not be lost, use `$job` (alepha/api/jobs) instead.**
 * It layers a durable, DB-backed outbox over this transport: at-least-once
 * delivery, retries, idempotency keys, priorities, crash recovery via a
 * reconciliation sweep, and failure records.
 *
 * **What $queue gives you**
 * - Type-safe payloads with schema validation at push and receive
 * - Background workers with graceful shutdown and lifecycle management
 * - Pluggable backends: memory (dev/test), Redis, Cloudflare Queues
 * - Cheap fire-and-forget fan-out where occasional loss is acceptable
 *   (cache invalidation, presence pings, metrics, live notifications)
 *
 * @example Loss-tolerant event fan-out
 * ```typescript
 * const activityQueue = $queue({
 *   name: "activity-events",
 *   schema: z.object({
 *     userId: z.text(),
 *     event: z.text(),
 *     at: z.number()
 *   }),
 *   handler: async (message) => {
 *     await metrics.track(message.payload);
 *   }
 * });
 *
 * // Push messages for background processing
 * await activityQueue.push({
 *   userId: "u1",
 *   event: "page-view",
 *   at: 1700000000000
 * });
 * ```
 *
 * @example Batch processing with Redis
 * ```typescript
 * const imageQueue = $queue({
 *   name: "image-processing",
 *   provider: RedisQueueProvider,
 *   schema: z.object({
 *     imageId: z.text(),
 *     operations: z.array(z.enum(["resize", "compress", "thumbnail"]))
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
 *   schema: z.object({
 *     taskType: z.enum(["cleanup", "backup", "report"]),
 *     data: z.record(z.text(), z.any())
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
  options: QueuePrimitiveOptions<T>,
): QueuePrimitive<T> => {
  return createPrimitive(QueuePrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface QueuePrimitiveOptions<T extends TSchema> {
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
   * - Production: Use Redis so multiple instances share one queue (note:
   *   a popped message is gone — the at-most-once caveat above applies)
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
   * Zod schema defining the structure of messages in this queue.
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
   * z.object({
   *   userId: z.text(),
   *   action: z.enum(["create", "update"]),
   *   data: z.record(z.text(), z.any()),
   *   timestamp: z.number().optional()
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
   * - Has access to the full Alepha dependency injection container
   * - **Loses the message if it throws** — errors are logged, not retried.
   *   Use `$job` when failed work must be retried or recorded.
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
   *     // The message is NOT redelivered after a throw — record the
   *     // failure yourself, or use $job for retryable work.
   *     this.logger.error(`Failed to send email to ${email}`, error);
   *     throw error;
   *   }
   * }
   * ```
   */
  handler?: (message: QueueMessage<T>) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class QueuePrimitive<T extends TSchema> extends Primitive<
  QueuePrimitiveOptions<T>
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
            // Encode on the way out, decode on the way in — the pairing
            // `$topic.publishMessage` already uses. This used to `decode` an
            // already-runtime payload, so the worker's decode was the second
            // one and nothing ever encoded. With the current codec the two
            // are identical, so this changes no bytes today; it stops a
            // future encoding change from silently corrupting queue payloads.
            payload: this.alepha.codec.encode(this.options.schema, payload),
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

$queue[KIND] = QueuePrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueMessageSchema {
  payload: TSchema;
}

export interface QueueMessage<T extends TSchema> {
  payload: Static<T>;
}
