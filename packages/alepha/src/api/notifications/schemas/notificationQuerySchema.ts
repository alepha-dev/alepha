import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "failed",
      "dead",
      "cancelled",
    ]),
  ),
});

export type NotificationQuery = Static<typeof notificationQuerySchema>;
