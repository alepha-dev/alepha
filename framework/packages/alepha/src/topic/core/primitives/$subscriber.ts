import type { PrimitiveSide } from "alepha";
import {
  createPrimitive,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
} from "alepha";
import { KIND } from "alepha/internal";

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
   * The handler run for every message published to the topic.
   *
   * It receives the decoded message, runs independently of the topic's
   * other subscribers, in a context of its own, and can use anything the
   * service injects.
   *
   * A handler that throws does not affect the other subscribers: the
   * provider catches the error and logs it, so there is nothing to catch
   * for that purpose. On a topic with a `response` schema, what the handler
   * returns is the reply to a `request()`, and a handler that throws sends
   * none (the requester times out): catching the error there and returning
   * normally would send a reply.
   *
   * A topic does not redeliver: make the handler idempotent, keep it short
   * on a busy topic, and hand heavy work or work that must not be lost to a
   * queue.
   *
   * @param message - The decoded message: `payload`, and `params` when the
   * topic's schema declares them
   *
   * @example
   * ```ts
   * handler: async (message) => {
   *   const { userId, eventType, timestamp } = message.payload;
   *
   *   switch (eventType) {
   *     case "user.login":
   *       await this.updateLastLogin(userId, timestamp);
   *       break;
   *     case "user.logout":
   *       await this.updateSessionDuration(userId, timestamp);
   *       break;
   *     default:
   *       this.log.warn(`Unknown event type: ${eventType}`);
   *   }
   * }
   * ```
   */
  handler: TopicHandler<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SubscriberPrimitive<
  T extends TopicMessageSchema,
> extends PipelinePrimitive<SubscriberPrimitiveOptions<T>> {
  /**
   * `boot` for the pure controller rule: read by TopicProvider at start.
   */
  public static override readonly side: PrimitiveSide = "boot";
}

$subscriber[KIND] = SubscriberPrimitive;
