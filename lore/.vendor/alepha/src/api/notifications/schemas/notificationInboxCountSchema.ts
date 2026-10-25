import { type Infer, z } from "alepha";

/**
 * What the bell needs and nothing else.
 *
 * Its own endpoint rather than a field on the list, because the count is
 * fetched on every navigation and on every window focus while the list is
 * fetched when somebody opens it.
 */
export const notificationInboxCountSchema = z.object({
  unread: z.number(),
});

export type NotificationInboxCount = Infer<typeof notificationInboxCountSchema>;
