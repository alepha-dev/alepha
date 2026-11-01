import { AdminAnalytics, type AnalyticsTransport } from "@alepha/ui/admin";
import type { ProjectAnalyticsController } from "@lore/core/api";
import { currentProjectAtom } from "@lore/core/web";
import { useClient, useStore } from "alepha/react";
import { useMemo } from "react";

/**
 * The query explorer over the project's own datasets (#Q3014). `project` is
 * absent rather than hidden: the scoped endpoint strips it from the
 * descriptors, as `AppExplore` explains for an app.
 */
const ReportsTeamExplorer = () => {
  const client = useClient<ProjectAnalyticsController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;

  // Memoised, and plain calls rather than `useQuery`, for `AppExplore`'s
  // reason: `AdminAnalytics` awaits these and reads a rejection as a failure.
  const transport = useMemo<AnalyticsTransport | undefined>(() => {
    if (projectId === undefined) {
      return undefined;
    }
    const params = { projectId };
    return {
      listDatasets: () => client.listProjectDatasets({ params }),
      queryDataset: (dataset, body) =>
        client.queryProjectDataset({
          params: { ...params, name: dataset },
          body,
        }),
      path: (dataset) =>
        `/api/projects/${projectId}/analytics/datasets/${dataset}/query`,
    };
  }, [client, projectId]);

  return (
    <div
      className="flex h-[640px] min-h-0 overflow-hidden rounded-lg border"
      data-testid="reports-team-explorer"
    >
      {transport && <AdminAnalytics transport={transport} />}
    </div>
  );
};

export default ReportsTeamExplorer;
