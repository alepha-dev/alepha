import {
  createPrimitive,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type Static,
  type TSchema,
} from "alepha";
import type { QueuePrimitive } from "./$queue.ts";

/**
 * Creates a consumer primitive to process messages from a specific queue.
 *
 * Provides a dedicated message consumer that connects to a queue and processes messages
 * with custom handler logic, enabling scalable architectures where multiple consumers
 * can process messages from the same queue.
 *
 * **Key Features**
 * - Seamless integration with any $queue primitive
 * - Full type safety inherited from queue schema
 * - Automatic worker management for background processing
 * - Built-in error handling and retry mechanisms
 * - Support for multiple consumers per queue for horizontal scaling
 *
 * **Common Use Cases**
 * - Email sending and notification services
 * - Image and media processing workers
 * - Data synchronization and background jobs
 *
 * @example
 * ```ts
 * class EmailService {
 *   emailQueue = $queue({
 *     name: "emails",
 *     schema: t.object({
 *       to: t.text(),
 *       subject: t.text(),
 *       body: t.text()
 *     })
 *   });
 *
 *   emailConsumer = $consumer({
 *     queue: this.emailQueue,
 *     handler: async (message) => {
 *       const { to, subject, body } = message.payload;
 *       await this.sendEmail(to, subject, body);
 *     }
 *   });
 *
 *   async sendWelcomeEmail(userEmail: string) {
 *     await this.emailQueue.push({
 *       to: userEmail,
 *       subject: "Welcome!",
 *       body: "Thanks for joining."
 *     });
 *   }
 * }
 * ```
 */
export const $consumer = <T extends TSchema>(
  options: ConsumerPrimitiveOptions<T>,
): ConsumerPrimitive<T> => {
  return createPrimitive(ConsumerPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ConsumerPrimitiveOptions<T extends TSchema>
  extends PipelinePrimitiveOptions {
  /**
   * The queue primitive that this consumer will process messages from.
   *
   * This establishes the connection between the consumer and its source queue:
   * - The consumer inherits the queue's message schema for type safety
   * - Messages pushed to the queue will be automatically routed to this consumer
   * - Multiple consumers can be attached to the same queue for parallel processing
   * - The consumer will use the queue's provider and configuration settings
   *
   * **Queue Integration Benefits**:
   * - Type safety: Consumer handler gets fully typed message payloads
   * - Schema validation: Messages are validated before reaching the consumer
   * - Error handling: Failed messages can be retried or moved to dead letter queues
   * - Monitoring: Queue metrics include consumer processing statistics
   *
   * @example
   * ```ts
   * // First, define a queue
   * emailQueue = $queue({
   *   name: "emails",
   *   schema: t.object({ to: t.text(), subject: t.text() })
   * });
   *
   * // Then, create a consumer for that queue
   * emailConsumer = $consumer({
   *   queue: this.emailQueue,  // Reference the queue primitive
   *   handler: async (message) => { } // process email
   * });
   * ```
   */
  queue: QueuePrimitive<T>;

  /**
   * Message handler function that processes individual messages from the queue.
   *
   * This function:
   * - Receives fully typed and validated message payloads from the connected queue
   * - Runs in the background worker system for non-blocking operation
   * - Should implement the core business logic for processing this message type
   * - Can throw errors to trigger the queue's retry mechanisms
   * - Has access to the full Alepha dependency injection container
   * - Should be idempotent to handle potential duplicate deliveries
   *
   * **Handler Design Guidelines**:
   * - Keep handlers focused on a single responsibility
   * - Use proper error handling and meaningful error messages
   * - Log important processing steps for debugging and monitoring
   * - Consider transaction boundaries for data consistency
   * - Make operations idempotent when possible
   * - Validate business rules within the handler logic
   *
   * **Error Handling Strategy**:
   * - Throw errors for temporary failures that should be retried
   * - Log and handle permanent failures gracefully
   * - Use specific error types to control retry behavior
   * - Consider implementing circuit breakers for external service calls
   *
   * @param message - The queue message containing the validated payload
   * @param message.payload - The typed message data based on the queue's schema
   * @returns Promise that resolves when processing is complete
   *
   * @example
   * ```ts
   * handler: async (message) => {
   *   const { userId, action, data } = message.payload;
   *
   *   try {
   *     // Log processing start
   *     this.logger.info(`Processing ${action} for user ${userId}`);
   *
   *     // Validate business rules
   *     if (!await this.userService.exists(userId)) {
   *       throw new Error(`User ${userId} not found`);
   *     }
   *
   *     // Perform the main processing logic
   *     switch (action) {
   *       case "create":
   *         await this.processCreation(userId, data);
   *         break;
   *       case "update":
   *         await this.processUpdate(userId, data);
   *         break;
   *       default:
   *         throw new Error(`Unknown action: ${action}`);
   *     }
   *
   *     // Log successful completion
   *     this.logger.info(`Successfully processed ${action} for user ${userId}`);
   *
   *   } catch (error) {
   *     // Log error with context
   *     this.logger.error(`Failed to process ${action} for user ${userId}`, {
   *       error: error.message,
   *       userId,
   *       action,
   *       data
   *     });
   *
   *     // Re-throw to trigger queue retry mechanism
   *     throw error;
   *   }
   * }
   * ```
   */
  handler: (message: { payload: Static<T> }) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ConsumerPrimitive<T extends TSchema> extends PipelinePrimitive<
  ConsumerPrimitiveOptions<T>
> {}

$consumer[KIND] = ConsumerPrimitive;
