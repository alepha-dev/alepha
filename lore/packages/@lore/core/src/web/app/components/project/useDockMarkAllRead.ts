import { inboxUnreadAtom } from "@alepha/ui/shell";
import type { NotificationInboxController } from "alepha/api/notifications";
import { useAction, useAlepha, useClient, useQueryClient } from "alepha/react";

import { DOCK_UNREAD_KEY } from "./useDockUnread.ts";

/**
 * "Mark all read" on a dock icon (#Q4531): every inbox message scoped to that
 * project, read in one call, as the bell does for all of them.
 *
 * The same tab follows at once: the dock's badges refetch under
 * {@link DOCK_UNREAD_KEY}, the account Inbox's lists under `inbox`, and the
 * bell's count, which counts every project, is read again.
 */
export const useDockMarkAllRead = () => {
  const inboxApi = useClient<NotificationInboxController>();
  const queries = useQueryClient();
  const alepha = useAlepha();
  return useAction<[projectId: number], void>(
    {
      handler: async (_context, projectId) => {
        await inboxApi.markAllInboxRead({
          query: { scope: `project:${projectId}` },
        });
        queries.invalidate([DOCK_UNREAD_KEY]);
        queries.invalidate(["inbox"]);
        const count = await inboxApi.countInbox({ query: {} });
        alepha.store.set(inboxUnreadAtom, { count: count.unread });
      },
    },
    [inboxApi, queries, alepha],
  );
};
