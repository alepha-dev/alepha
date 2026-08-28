import { type Infer, z } from "alepha";

/**
 * One row of the suppression list as an operator sees it.
 *
 * Everything here is already known to whoever can read the notification
 * outbox, so there is nothing to withhold: a suppression records that an
 * address said no, not anything the address was told.
 */
export const notificationSuppressionResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  organizationId: z.uuid().nullable().optional(),
  contact: z.text(),
  channel: z.enum(["email", "sms"]),
  reason: z.enum(["unsubscribed", "bounced", "complained"]),
  /**
   * The category this applies to, or `*` for every category.
   */
  category: z.text(),
  source: z.text(),
});

export type NotificationSuppressionResource = Infer<
  typeof notificationSuppressionResourceSchema
>;
