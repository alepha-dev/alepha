import { type Static, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = pageQuerySchema.extend({
  status: z
    .enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "dead",
      "cancelled",
    ])
    .optional(),
});

export type NotificationQuery = Static<typeof notificationQuerySchema>;
