import { type Infer, z } from "alepha";

/**
 * One row of the admin notification list.
 *
 * Backed by a delivery receipt, so `id` is the receipt's and `status` is
 * what happened to the message rather than what happened to the job that
 * sent it.
 */
export const notificationResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  /**
   * The job execution that produced this, and the join back to the outbox
   * row on the detail view - while that row still exists.
   */
  executionId: z.text(),
  status: z.text(),
  template: z.text().optional(),
  type: z.text().optional(),
  contact: z.text().optional(),
  category: z.text().optional(),
  critical: z.boolean().optional(),
  /**
   * Why the send was refused, when `status` is `skipped`.
   */
  skipReason: z.text().optional(),
  /**
   * The rendered subject, absent on a `sensitive` template.
   */
  subject: z.text().optional(),
  provider: z.text().optional(),
  messageId: z.text().optional(),
  smtpStatusCode: z.text().optional(),
  /**
   * When the transport last reported something about this message.
   */
  lastEventAt: z.datetime().optional(),
  error: z.text().optional(),
  /**
   * Whether the outbox row this receipt points at is still there.
   *
   * False means the message is older than the outbox retention window (7
   * days by default, against the receipt's 90), not that anything is wrong.
   * It is what lets the list disable Resend instead of offering an action
   * that can only fail.
   */
  outboxAvailable: z.boolean().optional(),
});

export type NotificationResource = Infer<typeof notificationResourceSchema>;
