import type {
  AdminAnalyticsController,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useState } from "react";

// Relative, like `markdown-view/diagram`: the package's export map appends
// `.tsx` to a bare `@alepha/ui/components/...` specifier, so a `.ts` hook
// under it resolves to a file that does not exist. Same package, same folder,
// no export map involved.
import type { AnalyticsTransport } from "./analytics/analyticsTypes.ts";
import { QueryPanel } from "./analytics/QueryPanel.tsx";
import { RequestDialog } from "./analytics/RequestDialog.tsx";
import { ResultsPane } from "./analytics/ResultsPane.tsx";
import { useAnalyticsQuery } from "./analytics/useAnalyticsQuery.ts";
import { usePanelWidth } from "./analytics/usePanelWidth.ts";

export type { AnalyticsTransport };

export interface AdminAnalyticsProps {
  /**
   * Which analytics API answers. Defaults to the unrestricted admin surface
   * at `/api/admin/analytics/*`, behind `admin:analytics:read`.
   *
   * An app passes its own to expose the builder to a non-admin over a
   * narrower slice of the same datasets. Nothing below this line changes:
   * a scoped endpoint publishes descriptors with its pinned dimensions
   * already removed, so the panel hides them by never being told they exist.
   */
  transport?: AnalyticsTransport;
}

/**
 * A query builder over every `$analytics()` dataset the application declares.
 *
 * Datasets, dimensions and measures all come from the admin API's JSON-Schema
 * descriptors, so nothing here is app-specific. The panel reads top to bottom
 * as one sentence (`from`, `select`, `on range`, `group by`, `where`), and
 * that is possible because the query language is small and closed: `since`,
 * `until`, `select`, `groupBy`, `orderBy`, `limit`, `filters`, sums only.
 *
 * Closed is also what lets the UI refuse a query the backend would answer
 * misleadingly rather than merely warn about one. The `hour` interlock is the
 * clearest case: past a dataset's hot window the rolled tier answers in days
 * while the raw tier answers in hours, and since those are different keys they
 * would not merge: you would get a plausible-looking wrong chart instead of
 * an error.
 *
 * The layout never scrolls as a page. Only the panel's clause list, the
 * results pane (Overview) or the grid body (Table) does, which is why every
 * intermediate column below carries `min-h-0`: without it a nested `flex-1
 * min-h-0` is inert and the page grows a second scrollbar.
 */
export const AdminAnalytics = (props: AdminAnalyticsProps) => {
  const client = useClient<AdminAnalyticsController>();
  const { tr } = useI18n();
  const [datasets, setDatasets] = useState<AdminDatasetDescriptor[]>();
  const [requestOpen, setRequestOpen] = useState(false);

  // Memoised because it is an effect dependency in both hooks below: a fresh
  // object each render would re-fire every query forever.
  const adminTransport = useMemo<AnalyticsTransport>(
    () => ({
      listDatasets: () => client.listDatasets(),
      queryDataset: (dataset, body) =>
        client.queryDataset({ params: { name: dataset }, body }),
      path: (dataset) => `/api/admin/analytics/datasets/${dataset}/query`,
    }),
    [client],
  );
  const transport = props.transport ?? adminTransport;

  const query = useAnalyticsQuery(datasets, transport);
  const panel = usePanelWidth();

  useEffect(() => {
    void transport.listDatasets().then(setDatasets);
  }, [transport]);

  if (datasets?.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-6 text-sm">
        {tr("admin.analytics.noDatasets", {
          default: "No analytics datasets are declared in this app.",
        })}
      </div>
    );
  }

  if (!datasets || !query.dataset) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <QueryPanel
        datasets={datasets}
        dataset={query.dataset}
        query={query}
        transport={transport}
        width={panel.width}
        onStartResize={panel.startResize}
        onRequest={() => setRequestOpen(true)}
      />
      <ResultsPane query={query} dataset={query.dataset.name} />
      <RequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        path={transport.path(query.dataset.name)}
        body={query.body}
      />
    </div>
  );
};

export default AdminAnalytics;
