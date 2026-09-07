import { type Infer, z } from "alepha";

/**
 * What the owner of an inbox may ask for.
 *
 * Notice what is not here: no user id. Every row is filtered by the
 * session's, so there is no parameter to get wrong later and no accidental
 * "read another user's inbox" one request away.
 */
export const notificationInboxQuerySchema = z.object({
  /**
   * Restrict to one app-owned partition, e.g. `project:65`.
   *
   * Passed through to an equality filter and never parsed: the framework
   * does not know what a project is and must not learn.
   */
  scope: z.text({ maxLength: 64 }).optional(),
  /**
   * Only messages the owner has not read yet.
   */
  unreadOnly: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
  /**
   * Where to continue from, taken verbatim from the previous page's
   * `nextCursor`.
   *
   * Opaque on purpose, so its shape can change without a client change. A
   * value that is not one of ours is a 400, never a silent page one: a
   * client paging with a stale cursor should be told, not quietly restarted
   * at the top of a list it has already read.
   */
  cursor: z.text({ maxLength: 200 }).optional(),
});

export type NotificationInboxQuery = Infer<typeof notificationInboxQuerySchema>;
