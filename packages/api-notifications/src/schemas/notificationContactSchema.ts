import { type Static, t } from "@alepha/core";

export const notificationContactSchema = t.object({
  email: t.optional(t.email()),
  phoneNumber: t.optional(t.e164()),
  firstName: t.optional(t.shortText()),
  lastName: t.optional(t.text({ size: "short" })),
  language: t.optional(t.bcp47()),
});

export type NotificationContact = Static<typeof notificationContactSchema>;
