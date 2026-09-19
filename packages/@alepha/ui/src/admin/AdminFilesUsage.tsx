import type { AdminFileStatsController } from "alepha/api/files";
import { useClient, useQuery } from "alepha/react";

import { Skeleton } from "../core/Skeleton.tsx";
import { AdminFilesUsageCard } from "./AdminFilesUsageCard.tsx";

export interface AdminFilesUsageProps {
  /**
   * The table's reload counter, from its summary `content` function: the
   * storage figures reload with the table, after an upload, a delete or a
   * Refresh.
   */
  refreshKey: number;
}

/**
 * The storage tile of the admin Files page, fetched.
 *
 * Quiet on failure, like the bucket filter beside it: the page works without
 * its figures, and a store whose stats cannot be read is not news to toast
 * on every visit. It draws nothing until a read succeeds.
 */
export const AdminFilesUsage = (props: AdminFilesUsageProps) => {
  const client = useClient<AdminFileStatsController>();
  const { data: stats, loading } = useQuery(
    {
      handler: ({ signal }) =>
        client.getFileStats({} as never, { request: { signal } }),
      onError: () => {},
    },
    [client, props.refreshKey],
  );

  if (stats) {
    return <AdminFilesUsageCard stats={stats} />;
  }
  return loading ? <Skeleton className="h-[108px] rounded-md" /> : null;
};
