import { type Static, t } from "alepha";

export const notificationPayloadSchema = t.object({
  type: t.enum(["email", "sms"]),
  template: t.text(),
  contact: t.text(),
  variables: t.optional(t.record(t.text(), t.any())),
  category: t.optional(t.text()),
  critical: t.optional(t.boolean()),
  sensitive: t.optional(t.boolean()),
});

export type NotificationPayload = Static<typeof notificationPayloadSchema>;
