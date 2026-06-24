import { type Static, z } from "alepha";

export const notificationPayloadSchema = z.object({
  type: z.enum(["email", "sms"]),
  template: z.text(),
  contact: z.text(),
  variables: z.record(z.text(), z.any()).optional(),
  category: z.text().optional(),
  critical: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  /** Recipient language (e.g. "fr" or "fr-FR") used to pick `translations`. */
  lang: z.text().optional(),
});

export type NotificationPayload = Static<typeof notificationPayloadSchema>;
