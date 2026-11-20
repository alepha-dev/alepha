import type { NotificationInboxController } from "alepha/api/notifications";
import { useClient, useQuery } from "alepha/react";

/**
 * The query key the dock's unread counts live under (#Q3981). A module that
 * learns of a new message (chat's live feed) invalidates it, rather than
 * importing the rail.
 */
export const DOCK_UNREAD_KEY = "dock-unread";

/**
 * Each docked project's unread count for the viewer (#Q3981): the inbox
 * messages scoped to that project and not read, which a chat mention of the
 * viewer is one of. A room's plain unread messages are not counted: they are
 * the Chat row's, in the project's own sidebar.
 *
 * One request for every docked project (`countInboxScopes`), refetched when
 * the tab regains focus, and invalidated under {@link DOCK_UNREAD_KEY} by
 * the inbox when it marks messages read and by chat's live feed when a
 * message arrives.
 */
export const useDockUnread = (projectIds: number[]): Map<number, number> => {
  const inboxApi = useClient<NotificationInboxController>();
  const ids = [...new Set(projectIds)].sort((a, b) => a - b);
  const counts = useQuery<Map<number, number>>(
    {
      key: [DOCK_UNREAD_KEY, ids.join(",")],
      enabled: ids.length > 0,
      refetchOnFocus: true,
      handler: async () => {
        const answer = await inboxApi.countInboxScopes({
          body: { scopes: ids.map((id) => `project:${id}`) },
        });
        return new Map(
          answer.counts.map((it) => [
            Number(it.scope.slice("project:".length)),
            it.unread,
          ]),
        );
      },
      // A badge that cannot load is no badge, never a toast.
      onError: () => {},
    },
    [inboxApi, ids.join(",")],
  );
  return counts.data ?? new Map();
};
