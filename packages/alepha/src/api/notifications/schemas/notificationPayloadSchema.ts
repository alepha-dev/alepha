import { type Static, t } from "alepha";

export const notificationPayloadSchema = t.object({
  type: t.enum(["email", "sms"]),
  template: t.text(),
  contact: t.text(),
  variables: t.optional(t.record(t.text(), t.any())),
  category: t.optional(t.text()),
  critical: t.optional(t.boolean()),
  sensitive: t.optional(t.boolean()),
  /** Recipient language (e.g. "fr" or "fr-FR") used to pick `translations`. */
  lang: t.optional(t.text()),
});

export type NotificationPayload = Static<typeof notificationPayloadSchema>;
