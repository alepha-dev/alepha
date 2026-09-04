import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Button } from "@alepha/ui/components/ui/button";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";

import type { InsightsController } from "@/api/controllers/InsightsController.ts";
import type { InsightsDimensionResource } from "@/api/schemas/insightsDimensionResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import {
  APP_INSIGHTS_FILTER_KEYS,
  useAppInsightsFilters,
} from "./useAppInsights.ts";

type Dimension = InsightsDimensionResource["dimension"];

/**
 * Which filter a row of this leaderboard sets when it is clicked.
 *
 * `entryPath` is the one that is not its own filter: it groups by `path` and
 * differs only in the measure, so filtering by a landing page is filtering by
 * that path. Getting this wrong would send `?entryPath=` to an endpoint that
 * declares no such dimension.
 */
const ROW_FILTER: Record<Dimension, (typeof APP_INSIGHTS_FILTER_KEYS)[number]> =
  {
    country: "country",
    path: "path",
    entryPath: "path",
    campaign: "campaign",
    device: "device",
    referrer: "referrer",
    browser: "browser",
    os: "os",
  };

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
> = {
  country: "insights.topCountries",
  path: "insights.topPaths",
  entryPath: "insights.topEntryPaths",
  campaign: "insights.topCampaigns",
  device: "insights.topDevices",
  referrer: "insights.topReferrers",
  browser: "insights.topBrowsers",
  os: "insights.topSystems",
};

/**
 * One leaderboard, the whole list, paged.
 *
 * Deliberately thin: a table, a title and a way back. The shape of what lives
 * under an app is going to move once deployments land here, and a page with
 * three features is a page that gets rewritten wholesale.
 *
 * It carries the overview's window and filters through the URL, so the detail
 * answers the same question the overview was asking when you left it, and
 * clicking a row applies that value as a filter and returns - which is what
 * closes the loop rather than leaving the reader on a dead end.
 */
const AppAnalyticsDimension = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const insightsApi = useClient<InsightsController>();
  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);
  const { filters, range, traffic } = useAppInsightsFilters();

  const dimension = routerState.params?.analyticsDimension as
    | Dimension
    | undefined;

  if (!project || !sigil || !dimension) {
    return null;
  }

  const params = { projectSlug: project.slug, appName: sigil.name };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void router.push("appAnalytics", { params, query: filters })
          }
        >
          <ArrowLeft />
          {tr("insights.backToOverview")}
        </Button>
        <h2 className="text-base font-semibold">{tr(TITLE[dimension])}</h2>
      </div>

      {/*
        The testid sits on a wrapper, not on the table: `AlephaTable` renders
        its own toolbar and pager and does not forward unknown props to any of
        them, so the attribute would land nowhere.
      */}
      <div
        data-testid="insights-dimension-table"
        className="flex min-h-0 flex-1 flex-col"
      >
        <AlephaTable<InsightsDimensionResource["rows"][number]>
          className="min-h-0 flex-1"
          // The one table in Lore that still names its own page size, and
          // deliberately: 50 IS in the footer picker, and a leaderboard opened
          // to read a long tail wants a long page. Every other table dropped
          // the prop with feedback #2093 - four of them opened at 25, which is
          // not in the picker at all, so the footer showed no option selected.
          // `AlephaTable`'s own fallback of 20 is the default now.
          defaultSize={50}
          emptyMessage={tr("common.noResults")}
          fetch={async ({ page, size }) => {
            const res = await insightsApi.getInsightsDimension({
              params: { projectId: project.id, dimension },
              query: {
                ...filters,
                range,
                traffic,
                sigilId: sigil.id,
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
          onRowClick={(row) =>
            void router.push("appAnalytics", {
              params,
              // The value becomes a filter on the overview. That is the loop:
              // the leaderboard is how a filter is reached, and the overview is
              // where it means something.
              query: { ...filters, [ROW_FILTER[dimension]]: row.value },
            })
          }
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
                  {row.count.toLocaleString()}
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
    </div>
  );
};

export default AppAnalyticsDimension;
