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

  /**
   * Free-text match on the contact, case-insensitive and wildcarded at both
   * ends.
   *
   * The contact is the only "who" a receipt carries - an email address or a
   * phone number, never a user id - so this is the whole of the recipient
   * search.
   */
  search: z.text().optional(),

  template: z.text().optional(),

  channel: z.text({ maxLength: 32 }).optional(),

  category: z.text().optional(),

  /**
   * Split the rows carrying a transport error from the rest.
   *
   * ⚠️ `false` is a real filter, meaning "rows with no error", and NOT the
   * absence of a filter. It has to be tested against `undefined` rather than
   * for truthiness, or asking for the healthy rows silently returns
   * everything.
   */
  hasError: z.boolean().optional(),

  createdAfter: z.datetime().optional(),

  createdBefore: z.datetime().optional(),
});

export type NotificationQuery = Infer<typeof notificationQuerySchema>;
