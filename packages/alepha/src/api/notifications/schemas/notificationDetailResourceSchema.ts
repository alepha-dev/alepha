import { type Infer, z } from "alepha";
import { logEntrySchema } from "alepha/logger";

import { notificationResourceSchema } from "./notificationResourceSchema.ts";

export const notificationDetailResourceSchema = notificationResourceSchema
  .extend({
    /**
     * The template's variables, from the outbox row.
     *
     * ⚠️ Present only while that row exists (it is purged at
     * `retentionDays`, 7 by default, while the receipt lives 90), and never
     * for a `sensitive` template. A client must render correctly with it
     * absent for either reason.
     */
    variables: z.record(z.text(), z.any()).optional(),
    /**
     * What was actually rendered: the subject always, and the body only when
     * `storeRenderedBody` is on. Never for a `sensitive` template.
     */
    rendered: z.record(z.text(), z.any()).optional(),
    /**
     * The job's logs, from the outbox row, and absent once it is purged.
     */
    logs: z.array(logEntrySchema).optional(),
    /**
     * Whether the outbox row was still there. False means the message is
     * older than the outbox retention window, not that anything is wrong.
     */
    outboxAvailable: z.boolean().optional(),
  })
  .meta({
    title: "NotificationDetailResource",
    description:
      "A delivery receipt, joined to its outbox row while that row still exists.",
  });

export type NotificationDetailResource = Infer<
  typeof notificationDetailResourceSchema
>;
