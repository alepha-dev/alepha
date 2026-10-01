import {
  createPrimitive,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
} from "alepha";

import type {
  TopicHandler,
  TopicMessageSchema,
  TopicPrimitive,
} from "./$topic.ts";

/**
 * Creates a subscriber primitive to listen for messages from a specific topic.
 *
 * Provides a dedicated message subscriber that connects to a topic and processes messages
 * with custom handler logic, enabling scalable pub/sub architectures where multiple
 * subscribers can react to the same events independently.
 *
 * **Key Features**
 * - Seamless integration with any $topic primitive
 * - Full type safety inherited from topic schema
 * - Real-time message delivery when events are published
 * - Error isolation between subscribers
 * - Support for multiple independent subscribers per topic
 *
 * **Common Use Cases**
 * - Notification services and audit logging
 * - Analytics and metrics collection
 * - Data synchronization and real-time UI updates
 *
 * @example
 * ```ts
 * class UserActivityService {
 *   dateTime = $inject(DateTimeProvider);
 *
 *   userEvents = $topic({
 *     name: "user-activity",
 *     schema: {
 *       payload: z.object({
 *         userId: z.text(),
 *         action: z.enum(["login", "logout", "purchase"]),
 *         timestamp: z.number()
 *       })
 *     }
 *   });
 *
 *   activityLogger = $subscriber({
 *     topic: this.userEvents,
 *     handler: async (message) => {
 *       const { userId, action, timestamp } = message.payload;
 *       await this.auditLogger.log({
 *         userId,
 *         action,
 *         timestamp
 *       });
 *     }
 *   });
 *
 *   async trackUserLogin(userId: string) {
 *     await this.userEvents.publish({
 *       userId,
 *       action: "login",
 *       timestamp: this.dateTime.nowMillis()
 *     });
 *   }
 * }
 * ```
 */
export const $subscriber = <T extends TopicMessageSchema>(
  options: SubscriberPrimitiveOptions<T>,
): SubscriberPrimitive<T> => {
  return createPrimitive(SubscriberPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SubscriberPrimitiveOptions<
  T extends TopicMessageSchema,
> extends PipelinePrimitiveOptions {
  /**
   * The topic primitive that this subscriber will listen to for messages.
   *
   * This establishes the connection between the subscriber and its source topic:
   * - The subscriber inherits the topic's message schema for type safety
   * - Messages published to the topic will be automatically delivered to this subscriber
   * - Multiple subscribers can listen to the same topic independently
   * - The subscriber will use the topic's provider and configuration settings
   *
   * **Topic Integration Benefits**:
   * - Type safety: Subscriber handler gets fully typed message payloads
   * - Schema validation: Messages are validated before reaching the subscriber
   * - Real-time delivery: Messages are delivered immediately upon publication
   * - Error isolation: Subscriber errors don't affect the topic or other subscribers
   * - Monitoring: Topic metrics include subscriber processing statistics
   *
   * @example
   * ```ts
   * // First, define a topic
   * userEvents = $topic({
   *   name: "user-activity",
   *   schema: {
   *     payload: z.object({ userId: z.text(), action: z.text() })
   *   }
   * });
   *
   * // Then, create a subscriber for that topic
   * activitySubscriber = $subscriber({
   *   topic: this.userEvents,  // Reference the topic primitive
   *   handler: async (message) => { } // Process messages here
   * });
   * ```
   */
  topic: TopicPrimitive<T>;

  /**
   * Message handler function that processes individual messages from the topic.
   *
   * This function:
   * - Receives fully typed and validated message payloads from the connected topic
   * - Executes immediately when messages are published to the topic
   * - Should implement the core business logic for reacting to these events
   * - Runs independently of other subscribers to the same topic
   * - Should handle errors gracefully to avoid affecting other subscribers
   * - Has access to the full Alepha dependency injection container
   *
   * **Handler Design Guidelines**:
   * - Keep handlers focused on a single responsibility
   * - Use proper error handling and logging
   * - Consider performance impact for high-frequency topics
   * - Make handlers idempotent when possible for reliability
   * - Validate business rules within the handler logic
   * - Log important processing steps for debugging and monitoring
   *
   * **Error Handling Strategy**:
   * - Log errors but don't re-throw to avoid affecting other subscribers
   * - Use try-catch blocks for external service calls
   * - Implement circuit breakers for resilience with external systems
   * - Monitor error rates and patterns for system health
   * - Consider implementing retry logic for temporary failures
   *
   * **Performance Considerations**:
   * - Keep handler execution time minimal for high-throughput topics
   * - Use background queues for heavy processing triggered by events
   * - Implement batching for efficiency when processing many similar events
   * - Consider async processing patterns for non-critical operations
   *
   * @param message - The topic message with validated payload and optional params
   * @param message.payload - The typed message data based on the topic's schema
   * @returns Promise that resolves when processing is complete
   *
   * @example
   * ```ts
   * handler: async (message) => {
   *   const { userId, eventType, timestamp } = message.payload;
   *
   *   try {
   *     // Log event receipt
   *     this.logger.info(`Processing ${eventType} event for user ${userId}`, {
   *       timestamp,
   *       userId,
   *       eventType
   *     });
   *
   *     // Perform event-specific processing
   *     switch (eventType) {
   *       case 'user.login':
   *         await this.updateLastLogin(userId, timestamp);
   *         await this.sendWelcomeNotification(userId);
   *         break;
   *       case 'user.logout':
   *         await this.updateSessionDuration(userId, timestamp);
   *         break;
   *       case 'user.purchase':
   *         await this.updateRewardsPoints(userId, message.payload.purchaseAmount);
   *         await this.triggerRecommendations(userId);
   *         break;
   *       default:
   *         this.logger.warn(`Unknown event type: ${eventType}`);
   *     }
   *
   *     // Update analytics
   *     await this.analytics.track(eventType, {
   *       userId,
   *       timestamp,
   *       source: 'topic-subscriber'
   *     });
   *
   *     this.logger.info(`Successfully processed ${eventType} for user ${userId}`);
   *
   *   } catch (error) {
   *     // Log error but don't re-throw to avoid affecting other subscribers
   *     this.logger.error(`Failed to process ${eventType} for user ${userId}`, {
   *       error: error.message,
   *       stack: error.stack,
   *       userId,
   *       eventType,
   *       timestamp
   *     });
   *
   *     // Optionally send to error tracking service
   *     await this.errorTracker.captureException(error, {
   *       context: { userId, eventType, timestamp },
   *       tags: { component: 'topic-subscriber' }
   *     });
   *   }
   * }
   * ```
   */
  handler: TopicHandler<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SubscriberPrimitive<
  T extends TopicMessageSchema,
> extends PipelinePrimitive<SubscriberPrimitiveOptions<T>> {}

$subscriber[KIND] = SubscriberPrimitive;
