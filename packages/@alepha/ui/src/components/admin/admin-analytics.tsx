import type {
  AdminAnalyticsController,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

// Relative, like `markdown-view/diagram`: the package's export map appends
// `.tsx` to a bare `@alepha/ui/components/...` specifier, so a `.ts` hook
// under it resolves to a file that does not exist. Same package, same folder,
// no export map involved.
import { QueryPanel } from "./analytics/QueryPanel.tsx";
import { RequestDialog } from "./analytics/RequestDialog.tsx";
import { ResultsPane } from "./analytics/ResultsPane.tsx";
import { useAnalyticsQuery } from "./analytics/useAnalyticsQuery.ts";
import { usePanelWidth } from "./analytics/usePanelWidth.ts";

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
export const AdminAnalytics = () => {
  const client = useClient<AdminAnalyticsController>();
  const { tr } = useI18n();
  const [datasets, setDatasets] = useState<AdminDatasetDescriptor[]>();
  const [requestOpen, setRequestOpen] = useState(false);

  const query = useAnalyticsQuery(datasets);
  const panel = usePanelWidth();

  useEffect(() => {
    void client.listDatasets().then(setDatasets);
  }, [client]);

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
        width={panel.width}
        onStartResize={panel.startResize}
        onRequest={() => setRequestOpen(true)}
      />
      <ResultsPane query={query} dataset={query.dataset.name} />
      <RequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        dataset={query.dataset.name}
        body={query.body}
      />
    </div>
  );
};

export default AdminAnalytics;
