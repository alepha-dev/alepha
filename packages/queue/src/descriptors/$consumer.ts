import {
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { QueueDescriptor } from "./$queue.ts";

/**
 * Creates a consumer descriptor to process messages from a specific queue.
 *
 * This descriptor creates a dedicated message consumer that connects to a queue and processes
 * its messages using a custom handler function. Consumers provide a clean way to separate
 * message production from consumption, enabling scalable architectures where multiple
 * consumers can process messages from the same queue.
 *
 * ## Key Features
 *
 * - **Queue Integration**: Seamlessly connects to any $queue descriptor
 * - **Type Safety**: Full TypeScript support inherited from the connected queue's schema
 * - **Dedicated Processing**: Isolated message processing logic separate from the queue
 * - **Worker Management**: Automatic integration with the worker system for background processing
 * - **Error Handling**: Built-in error handling and retry mechanisms from the queue system
 * - **Scalability**: Multiple consumers can process the same queue for horizontal scaling
 *
 * ## Use Cases
 *
 * Perfect for creating specialized message processors:
 * - Dedicated email sending services
 * - Image processing workers
 * - Data synchronization tasks
 * - Event handlers for specific domains
 * - Microservice message consumers
 * - Background job processors
 *
 * @example
 * **Basic consumer setup:**
 * ```ts
 * import { $queue, $consumer } from "@alepha/queue";
 * import { t } from "@alepha/core";
 *
 * class EmailService {
 *   // Define the queue
 *   emailQueue = $queue({
 *     name: "emails",
 *     schema: t.object({
 *       to: t.string(),
 *       subject: t.string(),
 *       body: t.string(),
 *       template: t.optional(t.string())
 *     })
 *   });
 *
 *   // Create a dedicated consumer for this queue
 *   emailConsumer = $consumer({
 *     queue: this.emailQueue,
 *     handler: async (message) => {
 *       const { to, subject, body, template } = message.payload;
 *
 *       if (template) {
 *         await this.sendTemplatedEmail(to, template, { subject, body });
 *       } else {
 *         await this.sendPlainEmail(to, subject, body);
 *       }
 *
 *       console.log(`Email sent to ${to}: ${subject}`);
 *     }
 *   });
 *
 *   async sendWelcomeEmail(userEmail: string) {
 *     // Push to queue - consumer will automatically process it
 *     await this.emailQueue.push({
 *       to: userEmail,
 *       subject: "Welcome!",
 *       body: "Thanks for joining our platform.",
 *       template: "welcome"
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Multiple specialized consumers for different message types:**
 * ```ts
 * class NotificationService {
 *   notificationQueue = $queue({
 *     name: "notifications",
 *     schema: t.object({
 *       type: t.union([t.literal("email"), t.literal("sms"), t.literal("push")]),
 *       recipient: t.string(),
 *       message: t.string(),
 *       metadata: t.optional(t.record(t.string(), t.any()))
 *     })
 *   });
 *
 *   // Email-specific consumer
 *   emailConsumer = $consumer({
 *     queue: this.notificationQueue,
 *     handler: async (message) => {
 *       if (message.payload.type === "email") {
 *         await this.emailProvider.send({
 *           to: message.payload.recipient,
 *           subject: message.payload.metadata?.subject || "Notification",
 *           body: message.payload.message
 *         });
 *       }
 *     }
 *   });
 *
 *   // SMS-specific consumer
 *   smsConsumer = $consumer({
 *     queue: this.notificationQueue,
 *     handler: async (message) => {
 *       if (message.payload.type === "sms") {
 *         await this.smsProvider.send({
 *           to: message.payload.recipient,
 *           message: message.payload.message
 *         });
 *       }
 *     }
 *   });
 *
 *   // Push notification consumer
 *   pushConsumer = $consumer({
 *     queue: this.notificationQueue,
 *     handler: async (message) => {
 *       if (message.payload.type === "push") {
 *         await this.pushProvider.send({
 *           deviceToken: message.payload.recipient,
 *           title: message.payload.metadata?.title || "Notification",
 *           body: message.payload.message
 *         });
 *       }
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Consumer with advanced error handling and logging:**
 * ```ts
 * class OrderProcessor {
 *   orderQueue = $queue({
 *     name: "order-processing",
 *     schema: t.object({
 *       orderId: t.string(),
 *       customerId: t.string(),
 *       items: t.array(t.object({
 *         productId: t.string(),
 *         quantity: t.number(),
 *         price: t.number()
 *       }))
 *     })
 *   });
 *
 *   orderConsumer = $consumer({
 *     queue: this.orderQueue,
 *     handler: async (message) => {
 *       const { orderId, customerId, items } = message.payload;
 *
 *       try {
 *         // Log processing start
 *         this.logger.info(`Processing order ${orderId} for customer ${customerId}`);
 *
 *         // Validate inventory
 *         await this.validateInventory(items);
 *
 *         // Process payment
 *         const paymentResult = await this.processPayment(orderId, items);
 *         if (!paymentResult.success) {
 *           throw new Error(`Payment failed: ${paymentResult.error}`);
 *         }
 *
 *         // Update inventory
 *         await this.updateInventory(items);
 *
 *         // Create shipment
 *         await this.createShipment(orderId, customerId);
 *
 *         // Send confirmation
 *         await this.sendOrderConfirmation(customerId, orderId);
 *
 *         this.logger.info(`Order ${orderId} processed successfully`);
 *
 *       } catch (error) {
 *         // Log detailed error information
 *         this.logger.error(`Failed to process order ${orderId}`, {
 *           error: error.message,
 *           orderId,
 *           customerId,
 *           itemCount: items.length
 *         });
 *
 *         // Re-throw to trigger queue retry mechanism
 *         throw error;
 *       }
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Consumer for batch processing with performance optimization:**
 * ```ts
 * class DataProcessor {
 *   dataQueue = $queue({
 *     name: "data-processing",
 *     schema: t.object({
 *       batchId: t.string(),
 *       records: t.array(t.object({
 *         id: t.string(),
 *         data: t.record(t.string(), t.any())
 *       })),
 *       processingOptions: t.object({
 *         validateData: t.boolean(),
 *         generateReport: t.boolean(),
 *         notifyCompletion: t.boolean()
 *       })
 *     })
 *   });
 *
 *   dataConsumer = $consumer({
 *     queue: this.dataQueue,
 *     handler: async (message) => {
 *       const { batchId, records, processingOptions } = message.payload;
 *       const startTime = Date.now();
 *
 *       this.logger.info(`Starting batch processing for ${batchId} with ${records.length} records`);
 *
 *       try {
 *         // Process records in chunks for better performance
 *         const chunkSize = 100;
 *         const chunks = this.chunkArray(records, chunkSize);
 *
 *         for (let i = 0; i < chunks.length; i++) {
 *           const chunk = chunks[i];
 *
 *           if (processingOptions.validateData) {
 *             await this.validateChunk(chunk);
 *           }
 *
 *           await this.processChunk(chunk);
 *
 *           // Log progress
 *           const progress = ((i + 1) / chunks.length) * 100;
 *           this.logger.debug(`Batch ${batchId} progress: ${progress.toFixed(1)}%`);
 *         }
 *
 *         if (processingOptions.generateReport) {
 *           await this.generateProcessingReport(batchId, records.length);
 *         }
 *
 *         if (processingOptions.notifyCompletion) {
 *           await this.notifyBatchCompletion(batchId);
 *         }
 *
 *         const duration = Date.now() - startTime;
 *         this.logger.info(`Batch ${batchId} completed in ${duration}ms`);
 *
 *       } catch (error) {
 *         const duration = Date.now() - startTime;
 *         this.logger.error(`Batch ${batchId} failed after ${duration}ms`, error);
 *         throw error;
 *       }
 *     }
 *   });
 * }
 * ```
 */
export const $consumer = <T extends TSchema>(
	options: ConsumerDescriptorOptions<T>,
): ConsumerDescriptor<T> => {
	return createDescriptor(ConsumerDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ConsumerDescriptorOptions<T extends TSchema> {
	/**
	 * The queue descriptor that this consumer will process messages from.
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
	 *   schema: t.object({ to: t.string(), subject: t.string() })
	 * });
	 *
	 * // Then, create a consumer for that queue
	 * emailConsumer = $consumer({
	 *   queue: this.emailQueue,  // Reference the queue descriptor
	 *   handler: async (message) => { } // process email
	 * });
	 * ```
	 */
	queue: QueueDescriptor<T>;

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
	handler: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ConsumerDescriptor<T extends TSchema> extends Descriptor<
	ConsumerDescriptorOptions<T>
> {}

$consumer[KIND] = ConsumerDescriptor;
