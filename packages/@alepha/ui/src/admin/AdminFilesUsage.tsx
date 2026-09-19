import type { AdminFileStatsController } from "alepha/api/files";
import { useClient, useQuery, useQueryClient } from "alepha/react";
import { useEffect, useRef } from "react";

import { Skeleton } from "../core/Skeleton.tsx";
import { AdminFilesUsageCard } from "./AdminFilesUsageCard.tsx";

/**
 * The cache entry every mount of the tile shares.
 */
const STATS_KEY = ["admin-file-stats"];

export interface AdminFilesUsageProps {
  /**
   * The table's reload counter, from its summary `content` function: an
   * upload, a delete or Refresh moves it, and that is what re-reads the
   * figures.
   */
  refreshKey: number;
}

/**
 * The storage tile of the admin Files page, fetched.
 *
 * Quiet on failure, like the bucket filter beside it: the page works without
 * its figures, and a store whose stats cannot be read is not news to toast
 * on every visit. It draws nothing until a read succeeds.
 *
 * ## One read, then the cache
 *
 * ⚠️ **This component mounts often.** It lives in the table's summary panel,
 * which is collapsible and remembers nothing: expanding it again rebuilt the
 * tile from nothing and asked the server for a `SUM` over every file row,
 * every time. The key shares one entry across those mounts and `staleTime`
 * serves it without a request, so toggling the panel is free.
 *
 * Ten minutes is long because the tile is a rounded total, not a ledger:
 * "230.0 MB" does not move visibly in that window.
 *
 * ⚠️ **A fresh entry means the query does not run at all**, deps change or
 * not, so `refreshKey` cannot refetch by being a dependency - it has to
 * remove the entry. That is what the effect below does, and it is why
 * Refresh, an upload and a delete still update the figures at once. Without
 * it the button would look like it worked and change nothing.
 */
export const AdminFilesUsage = (props: AdminFilesUsageProps) => {
  const client = useClient<AdminFileStatsController>();
  const queries = useQueryClient();
  const { data: stats, loading } = useQuery(
    {
      key: STATS_KEY,
      staleTime: [10, "minutes"],
      handler: ({ signal }) =>
        client.getFileStats({} as never, { request: { signal } }),
      onError: () => {},
    },
    [client],
  );

  // The mount's own `refreshKey` is not a reload: invalidating on it would
  // drop the entry this mount just read, which is the request the cache
  // exists to avoid.
  const seen = useRef(props.refreshKey);
  useEffect(() => {
    if (seen.current === props.refreshKey) {
      return;
    }
    seen.current = props.refreshKey;
    queries.invalidate(STATS_KEY);
  }, [props.refreshKey, queries]);

  if (stats) {
    return <AdminFilesUsageCard stats={stats} />;
  }
  return loading ? <Skeleton className="h-[108px] rounded-md" /> : null;
};
