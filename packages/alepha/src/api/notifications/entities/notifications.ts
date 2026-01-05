import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const notifications = $entity({
  name: "notifications",
  schema: t.object({
    id: db.primaryKey(t.uuid()),

    version: db.version(),

    createdAt: db.createdAt(),

    updatedAt: db.updatedAt(),

    // -----------------------------------------------------------------------------------------------------------------

    type: t.enum(["email", "sms"]),

    template: t.text(), // e.g. 'resetPassword'

    category: t.optional(
      t.text({
        description:
          "For grouping related notifications (e.g., 'authentication', 'marketing'). Contact can filter notifications by category.",
      }),
    ),

    critical: t.optional(
      t.boolean({
        description:
          "Prioritize delivery of this notification. Set to true for important system alerts.",
      }),
    ),

    sensitive: t.optional(
      t.boolean({
        description:
          "Message won't be logged or stored in plain text. Set to true when notification contains passwords or codes.",
      }),
    ),

    // -----------------------------------------------------------------------------------------------------------------

    contact: t.text(), // e.g. email address or phone number or user ID or whatever

    variables: t.optional(t.record(t.text(), t.any())),

    scheduledAt: t.optional(
      t.datetime({
        description:
          "When set, the notification will be sent at or after this date/time.",
      }),
    ),

    // -----------------------------------------------------------------------------------------------------------------

    sentAt: t.optional(t.datetime()),

    error: t.optional(
      t.object({
        at: t.datetime(),
        name: t.text(),
        message: t.text({ size: "rich" }),
      }),
    ),

    // TODO: retryCount, lastRetryAt, etc.
  }),
});

export type NotificationEntity = Static<typeof notifications.schema>;
