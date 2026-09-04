import { type Infer, z } from "alepha";

/**
 * One transport's report about a message, normalized.
 *
 * Cloudflare publishes six event types through Queues, Brevo posts seven
 * webhook names, and SMTP reports nothing at all. This is the shape they all
 * map onto, so the receipt writer and the suppression writer each have one
 * thing to understand instead of one per provider.
 */
export const notificationDeliveryEventSchema = z.object({
  provider: z.text(),
  /**
   * The provider's own id for this event, used to make replay a no-op.
   * Queues is at-least-once and webhooks are retried.
   */
  eventId: z.text().optional(),
  /**
   * The message this is about. Matched against a receipt's `messageId`.
   */
  messageId: z.text(),
  contact: z.text(),
  channel: z.text({ maxLength: 32 }),
  status: z.enum([
    "delivered",
    "deferred",
    "bounced",
    "complained",
    "failed",
    "rejected",
  ]),
  /**
   * ⚠️ Hard versus soft, and it is NOT the same as "terminal". Cloudflare
   * marks every `message.bounced` terminal, including the ones that only
   * exhausted temporary retries. Only a `hard` bounce means a dead address.
   */
  bounce: z.enum(["hard", "soft"]).optional(),
  smtpStatusCode: z.text().optional(),
  /**
   * The provider's untouched payload, for an operator staring at something
   * the normalization lost.
   */
  raw: z.record(z.text(), z.any()),
  occurredAt: z.text(),
});

export type NotificationDeliveryEvent = Infer<
  typeof notificationDeliveryEventSchema
>;
