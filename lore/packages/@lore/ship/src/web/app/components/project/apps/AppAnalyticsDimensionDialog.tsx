import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { InsightsController } from "../../../../../api/controllers/InsightsController.ts";
import type { InsightsDimensionResource } from "../../../../../api/schemas/insightsDimensionResourceSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { useAppInsightsFilters } from "./useAppInsights.ts";

type Dimension = InsightsDimensionResource["dimension"];

export interface AppAnalyticsDimensionDialogProps {
  /**
   * The leaderboard to list in full, or `undefined` for a closed dialog.
   */
  dimension?: Dimension;
  onClose: () => void;
  /**
   * A row was clicked: narrow the tab to that value of the dimension.
   */
  onPick: (dimension: Dimension, value: string) => void;
}

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const TITLE: Record<
  Dimension,
  | "insights.topCountries"
  | "insights.topPaths"
  | "insights.topEntryPaths"
  | "insights.topCampaigns"
  | "insights.topDevices"
  | "insights.topReferrers"
  | "insights.topBrowsers"
  | "insights.topSystems"
  | "insights.topAudience"
  | "insights.topExitPaths"
  | "insights.topNetworks"
> = {
  country: "insights.topCountries",
  path: "insights.topPaths",
  entry: "insights.topEntryPaths",
  exit: "insights.topExitPaths",
  network: "insights.topNetworks",
  campaign: "insights.topCampaigns",
  device: "insights.topDevices",
  referrer: "insights.topReferrers",
  browser: "insights.topBrowsers",
  os: "insights.topSystems",
  auth: "insights.topAudience",
};

/**
 * One leaderboard, the whole list, paged, in a dialog over the Analytics tab
 * (#Q3674). It used to be its own page, `/analytics/:dimension`, with a "Back
 * to overview" link; a dialog keeps the reader's place, the period and the
 * filters, and that URL now redirects to the tab with this open.
 *
 * It reads the tab's window and filters from the URL, so it answers the same
 * question the tab was asking, and a row click applies that value as a
 * filter and closes: the leaderboard is how a filter is reached, the tab is
 * where it means something.
 */
const AppAnalyticsDimensionDialog = (
  props: AppAnalyticsDimensionDialogProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const insightsApi = useClient<InsightsController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const { filters, range, traffic } = useAppInsightsFilters();
  const dimension = props.dimension;
  const sigilId = instance?.sigil?.id;

  return (
    <Dialog
      open={dimension !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-visible sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dimension ? tr(TITLE[dimension]) : ""}</DialogTitle>
        </DialogHeader>
        {/*
          The testid sits on a wrapper, not on the table: `DataTable` renders
          its own toolbar and pager and does not forward unknown props to any
          of them, so the attribute would land nowhere.
        */}
        {dimension && project && sigilId && (
          <div
            data-testid="insights-dimension-table"
            className="flex min-h-[24rem] flex-1 flex-col"
          >
            <DataTable<InsightsDimensionResource["rows"][number]>
              className="min-h-0 flex-1"
              // The one table in Lore that still names its own page size, and
              // deliberately: 50 IS in the footer picker, and a leaderboard opened
              // to read a long tail wants a long page. Every other table dropped
              // the prop with feedback #2093 - four of them opened at 25, which is
              // not in the picker at all, so the footer showed no option selected.
              // `DataTable`'s own fallback of 20 is the default now.
              defaultSize={50}
              emptyMessage={tr("common.noResults")}
              fetch={async ({ page, size }) => {
                const res = await insightsApi.getInsightsDimension({
                  params: { projectId: project.id, dimension },
                  query: {
                    ...filters,
                    range,
                    traffic,
                    sigilId,
                    limit: size,
                    offset: page * size,
                  },
                });

                return {
                  content: res.rows,
                  page: {
                    number: page,
                    size,
                    offset: page * size,
                    numberOfElements: res.rows.length,
                    // Deliberately absent. The endpoint pages by over-fetching one
                    // row (the analytics seam has no `offset`, so depth IS the
                    // query's cost) and never counts the leaderboard, so there is no
                    // total to state. The table renders "?" for it, which is the
                    // true answer; a synthesised number would not be.
                    totalElements: undefined,
                    // A lower bound, not a claim: the pages known to exist. Without
                    // it the table hides its pager entirely, so "unknown" would cost
                    // the reader the next-page button rather than a number.
                    totalPages: page + 1 + (res.hasMore ? 1 : 0),
                    isEmpty: res.rows.length === 0,
                    isFirst: page === 0,
                    isLast: !res.hasMore,
                    sort: { sorted: true, fields: [] },
                  },
                };
              }}
              onRowClick={(row) => props.onPick(dimension, row.value)}
              columns={{
                value: {
                  label: tr("insights.dimension.value"),
                  className: "w-full max-w-0 min-w-48",
                  cell: (row) => (
                    <span className="block truncate" title={row.value}>
                      {row.value}
                    </span>
                  ),
                },
                count: {
                  label: tr("insights.dimension.count"),
                  cell: (row) => (
                    <span className="tabular-nums">
                      {row.views.toLocaleString()}
                    </span>
                  ),
                },
                percentage: {
                  label: tr("insights.dimension.share"),
                  cell: (row) => (
                    <span className="text-muted-foreground tabular-nums">
                      {row.percentage}%
                    </span>
                  ),
                },
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AppAnalyticsDimensionDialog;
