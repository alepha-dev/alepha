import { type Static, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = pageQuerySchema.extend({
  /**
   * Filter by delivery state.
   *
   * These are the `job_executions.status` values the notification outbox
   * actually writes — `ok` and `error` are terminal, `scheduled` means a retry
   * is pending. The enum previously advertised `retrying` / `completed` /
   * `dead`, which nothing ever produced.
   */
  status: z
    .enum(["pending", "scheduled", "running", "ok", "error", "cancelled"])
    .optional(),
});

export type NotificationQuery = Static<typeof notificationQuerySchema>;
