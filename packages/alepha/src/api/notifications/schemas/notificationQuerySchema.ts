import { type Infer, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = pageQuerySchema.extend({
  /**
   * Filter by delivery state.
   *
   * ⚠️ These are the **receipt** statuses, not the job's. The admin list is
   * backed by `notification_deliveries` rather than by `job_executions`,
   * because "the provider accepted it" (`ok`) is not the question an
   * operator is asking. `sent` means accepted; `delivered`, `bounced` and
   * `complained` arrive later from the transport; `skipped` means the gate
   * refused it and no message was ever sent.
   *
   * The previous vocabulary was the job's own (`pending`, `ok`, `error`, …)
   * and is gone with the table it described.
   */
  status: z
    .enum([
      "sent",
      "delivered",
      "deferred",
      "bounced",
      "complained",
      "failed",
      "rejected",
      "skipped",
    ])
    .optional(),
});

export type NotificationQuery = Infer<typeof notificationQuerySchema>;
