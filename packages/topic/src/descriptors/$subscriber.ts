import { createDescriptor, Descriptor, KIND } from "@alepha/core";
import type {
	TopicDescriptor,
	TopicHandler,
	TopicMessageSchema,
} from "./$topic.ts";

/**
 * Creates a subscriber descriptor to listen for messages from a specific topic.
 *
 * This descriptor creates a dedicated message subscriber that connects to a topic and processes
 * its messages using a custom handler function. Subscribers provide a clean way to separate
 * message publishing from consumption, enabling scalable pub/sub architectures where multiple
 * subscribers can react to the same events independently.
 *
 * ## Key Features
 *
 * - **Topic Integration**: Seamlessly connects to any $topic descriptor
 * - **Type Safety**: Full TypeScript support inherited from the connected topic's schema
 * - **Dedicated Processing**: Isolated message processing logic separate from the topic
 * - **Real-time Processing**: Immediate message delivery when events are published
 * - **Error Isolation**: Subscriber errors don't affect other subscribers or the topic
 * - **Scalability**: Multiple subscribers can listen to the same topic independently
 *
 * ## Use Cases
 *
 * Perfect for creating specialized event handlers:
 * - Notification services for user events
 * - Analytics and logging systems
 * - Data synchronization between services
 * - Real-time UI updates
 * - Event-driven workflow triggers
 * - Audit and compliance logging
 *
 * @example
 * **Basic subscriber setup:**
 * ```ts
 * import { $topic, $subscriber } from "alepha/topic";
 * import { t } from "alepha";
 *
 * class UserActivityService {
 *   // Define the topic
 *   userEvents = $topic({
 *     name: "user-activity",
 *     schema: {
 *       payload: t.object({
 *         userId: t.text(),
 *         action: t.enum(["login", "logout", "purchase"]),
 *         timestamp: t.number(),
 *         metadata: t.optional(t.record(t.text(), t.any()))
 *       })
 *     }
 *   });
 *
 *   // Create a dedicated subscriber for this topic
 *   activityLogger = $subscriber({
 *     topic: this.userEvents,
 *     handler: async (message) => {
 *       const { userId, action, timestamp } = message.payload;
 *
 *       await this.auditLogger.log({
 *         event: 'user_activity',
 *         userId,
 *         action,
 *         timestamp,
 *         source: 'user-activity-topic'
 *       });
 *
 *       this.log.info(`User ${userId} performed ${action} at ${new Date(timestamp).toISOString()}`);
 *     }
 *   });
 *
 *   async trackUserLogin(userId: string, metadata: Record<string, any>) {
 *     // Publish to topic - subscriber will automatically process it
 *     await this.userEvents.publish({
 *       userId,
 *       action: "login",
 *       timestamp: Date.now(),
 *       metadata
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Subscriber with advanced error handling and filtering:**
 * ```ts
 * class NotificationSubscriber {
 *   systemEvents = $topic({
 *     name: "system-events",
 *     schema: {
 *       payload: t.object({
 *         eventType: t.text(),
 *         severity: t.enum(["info", "warning", "error"]),
 *         serviceId: t.text(),
 *         message: t.text(),
 *         data: t.optional(t.record(t.text(), t.any()))
 *       })
 *     }
 *   });
 *
 *   alertSubscriber = $subscriber({
 *     topic: this.systemEvents,
 *     handler: async (message) => {
 *       const { eventType, severity, serviceId, message: eventMessage, data } = message.payload;
 *
 *       try {
 *         // Only process error events for alerting
 *         if (severity !== 'error') {
 *           return;
 *         }
 *
 *         // Log the event
 *         this.logger.error(`System alert from ${serviceId}`, {
 *           eventType,
 *           message: eventMessage,
 *           data
 *         });
 *
 *         // Send alerts based on service criticality
 *         const criticalServices = ['payment', 'auth', 'database'];
 *         const isCritical = criticalServices.includes(serviceId);
 *
 *         if (isCritical) {
 *           // Immediate alert for critical services
 *           await this.alertService.sendImmediate({
 *             title: `Critical Error in ${serviceId}`,
 *             message: eventMessage,
 *             severity: 'critical',
 *             metadata: { eventType, serviceId, data }
 *           });
 *         } else {
 *           // Queue non-critical alerts for batching
 *           await this.alertService.queueAlert({
 *             title: `Error in ${serviceId}`,
 *             message: eventMessage,
 *             severity: 'error',
 *             metadata: { eventType, serviceId, data }
 *           });
 *         }
 *
 *         // Update service health status
 *         await this.healthMonitor.recordError(serviceId, eventType);
 *
 *       } catch (error) {
 *         // Log subscriber errors but don't re-throw
 *         // This prevents one failing subscriber from affecting others
 *         this.log.error(`Alert subscriber failed`, {
 *           originalEvent: { eventType, serviceId, severity },
 *           subscriberError: error.message
 *         });
 *       }
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Subscriber for real-time data aggregation:**
 * ```ts
 * class MetricsAggregator {
 *   userActivityTopic = $topic({
 *     name: "user-metrics",
 *     schema: {
 *       payload: t.object({
 *         userId: t.text(),
 *         sessionId: t.text(),
 *         eventType: t.text(),
 *         timestamp: t.number(),
 *         duration: t.optional(t.number()),
 *         metadata: t.optional(t.record(t.text(), t.any()))
 *       })
 *     }
 *   });
 *
 *   metricsSubscriber = $subscriber({
 *     topic: this.userActivityTopic,
 *     handler: async (message) => {
 *       const { userId, sessionId, eventType, timestamp, duration, metadata } = message.payload;
 *
 *       // Update real-time metrics
 *       await Promise.all([
 *         // Update user activity counters
 *         this.metricsStore.increment(`user:${userId}:events:${eventType}`, 1),
 *         this.metricsStore.increment(`global:events:${eventType}`, 1),
 *
 *         // Track session activity
 *         this.sessionStore.updateActivity(sessionId, timestamp),
 *
 *         // Record duration metrics if provided
 *         duration ? this.metricsStore.recordDuration(`events:${eventType}:duration`, duration) : Promise.resolve(),
 *
 *         // Update time-based aggregations
 *         this.timeSeriesStore.addPoint({
 *           metric: `user_activity.${eventType}`,
 *           timestamp,
 *           value: 1,
 *           tags: { userId, sessionId }
 *         })
 *       ]);
 *
 *       // Trigger real-time dashboard updates
 *       await this.dashboardService.updateRealTimeStats({
 *         eventType,
 *         userId,
 *         timestamp
 *       });
 *
 *       this.logger.debug(`Processed metrics for ${eventType}`, {
 *         userId,
 *         eventType,
 *         timestamp
 *       });
 *     }
 *   });
 * }
 * ```
 */
export const $subscriber = <T extends TopicMessageSchema>(
	options: SubscriberDescriptorOptions<T>,
): SubscriberDescriptor<T> => {
	return createDescriptor(SubscriberDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SubscriberDescriptorOptions<T extends TopicMessageSchema> {
	/**
	 * The topic descriptor that this subscriber will listen to for messages.
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
	 *     payload: t.object({ userId: t.text(), action: t.text() })
	 *   }
	 * });
	 *
	 * // Then, create a subscriber for that topic
	 * activitySubscriber = $subscriber({
	 *   topic: this.userEvents,  // Reference the topic descriptor
	 *   handler: async (message) => { } // Process messages here
	 * });
	 * ```
	 */
	topic: TopicDescriptor<T>;

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
	 * @param message - The topic message with validated payload and optional headers
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

export class SubscriberDescriptor<
	T extends TopicMessageSchema,
> extends Descriptor<SubscriberDescriptorOptions<T>> {}

$subscriber[KIND] = SubscriberDescriptor;
