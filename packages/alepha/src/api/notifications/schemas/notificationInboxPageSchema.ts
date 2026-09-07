import { type Infer, z } from "alepha";

import { notificationInboxResourceSchema } from "./notificationInboxResourceSchema.ts";

/**
 * One page of somebody's inbox.
 *
 * Cursor paged rather than offset paged, and therefore not `z.page(...)`:
 * this list is append-heavy, so an offset page shifts under the reader every
 * time a message arrives, showing one message twice and hiding another.
 *
 * `unreadCount` rides along because every surface that lists messages also
 * shows a badge, and asking for both in one round trip is the difference
 * between one query and two on every page load.
 */
export const notificationInboxPageSchema = z.object({
  items: z.array(notificationInboxResourceSchema),
  /**
   * The caller's unread total, under the same `scope` filter as the list and
   * regardless of `unreadOnly`.
   */
  unreadCount: z.number(),
  /**
   * Pass back as `cursor` for the next page. Absent on the last one.
   */
  nextCursor: z.text().optional(),
});

export type NotificationInboxPage = Infer<typeof notificationInboxPageSchema>;
