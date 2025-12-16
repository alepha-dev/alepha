import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = t.extend(pageQuerySchema, {
  type: t.optional(t.enum(["email", "sms"])),
  template: t.optional(t.string()),
  contact: t.optional(t.string()),
  category: t.optional(t.string()),
  status: t.optional(t.enum(["pending", "sent", "failed"])),
});

export type NotificationQuery = Static<typeof notificationQuerySchema>;
