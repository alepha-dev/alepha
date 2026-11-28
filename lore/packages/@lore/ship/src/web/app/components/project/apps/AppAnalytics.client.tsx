import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  BarChart3,
  Clock,
  Eye,
  Info,
  MousePointerClick,
  Route,
  Users,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";

import type { InsightsDimensionResource } from "../../../../../api/schemas/insightsDimensionResourceSchema.ts";
import type { InsightsResource } from "../../../../../api/schemas/insightsResourceSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { ANALYTICS_DIMENSIONS } from "./analyticsDimensions.ts";
import AppAnalyticsDimensionDialog from "./AppAnalyticsDimensionDialog.tsx";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";
import AppAnalyticsFilterChips from "./AppAnalyticsFilterChips.tsx";
import AppAnalyticsLeaderboard, {
  type AppAnalyticsLeaderboardSegment,
} from "./AppAnalyticsLeaderboard.tsx";
import AppAnalyticsTile from "./AppAnalyticsTile.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { APP_INSIGHTS_ROW_FILTER, useAppInsights } from "./useAppInsights.ts";

type Tr = ReturnType<typeof useI18n<I18n, "en">>["tr"];
type L = ReturnType<typeof useI18n<I18n, "en">>["l"];
type Grain = InsightsResource["grain"];

/**
 * Pageview analytics for one app, in one dense overview, in the order the
 * questions are asked: what am I looking at (the controls, the window and the
 * filters), how much (five tiles), when (one chart), and where from (four
 * leaderboard cards).
 *
 * **Clicking a leaderboard row filters the whole page.** Everything narrows
 * together, because the filter rides in the URL with the window, Compare and
 * the traffic, and the whole payload is fetched under it.
 *
 * Visitors, visits and the visit rates exist only where they are counted:
 * not under Bots (a declared bot has no session), and not before the day the
 * app's visitors started being counted. There the page shows views only,
 * and says so.
 */
const AppAnalytics = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const {
    data,
    loading,
    error,
    traffic,
    compare,
    filters,
    patch,
    leaderboard,
  } = useAppInsights();

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <AppAnalyticsFilterChips
        filters={filters}
        onClear={(key) => patch({ [key]: undefined })}
        onClearAll={() =>
          patch(
            Object.fromEntries(Object.keys(filters).map((k) => [k, undefined])),
          )
        }
      />
      <div className="ml-auto">
        <AppInsightsControls loading={loading} showTraffic showCompare />
      </div>
    </div>
  );

  const errorLine = error && (
    <p className="text-sm text-red-600 dark:text-red-400">
      {tr("insights.error")}
    </p>
  );

  if (!data || !project || !instance) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {controls}
        {errorLine}
      </div>
    );
  }

  // A leaderboard's full list opens in a dialog over the tab (#Q3674), named
  // in the URL so a reload or a link reopens it. Any other change closes it.
  const openDimension = ANALYTICS_DIMENSIONS.has(leaderboard ?? "")
    ? (leaderboard as InsightsDimensionResource["dimension"])
    : undefined;
  const pick = (
    dimension: InsightsDimensionResource["dimension"],
    value: string,
  ) => patch({ [APP_INSIGHTS_ROW_FILTER[dimension]]: value });

  const bots = traffic === "bots";
  const totals = data.totals;
  const previous = compare ? data.previous?.totals : undefined;
  // Views only: under Bots, or a window wholly before visitors were counted.
  const viewsOnly = bots || totals.visitors === null;
  const day = (iso: string) =>
    l(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`), {
      timezone: "UTC",
      date: { day: "numeric", month: "short", year: "numeric" },
    });

  const totalViews = totals.views ?? 0;
  const share = (count: number) =>
    totalViews > 0 ? Math.round((count / totalViews) * 100) : 0;

  const board = (
    dimension: keyof typeof data.leaderboards,
    label: (value: string) => string = (value) => value,
  ) =>
    data.leaderboards[dimension].map((row) => ({
      value: row.value,
      label: label(row.value),
      visitors: row.visitors,
      views: row.views,
      percentage: share(row.views),
    }));

  const segments = (
    ...list: Array<Omit<AppAnalyticsLeaderboardSegment, "onMore">>
  ): AppAnalyticsLeaderboardSegment[] =>
    list.map((entry) => ({
      ...entry,
      onMore: () => patch({ leaderboard: entry.dimension }),
    }));

  // What the visitor count is, said under it: a sum, counted from a later
  // day, people only, or nothing at all under Bots.
  const sumReason = visitorsSumReason(tr, data);
  const visitorNotes: string[] = [];
  if (bots) {
    visitorNotes.push(tr("insights.visitors.bots"));
  } else {
    if (sumReason) visitorNotes.push(sumReason);
    if (data.visitorsFrom) {
      visitorNotes.push(
        tr("insights.visitors.countedFrom", { args: [day(data.visitorsFrom)] }),
      );
    }
    if (data.peopleOnly && totals.visitors !== null) {
      visitorNotes.push(tr("insights.uniqueVisitors.peopleOnly"));
    }
  }

  const timeline = data.timeline.map((p) => ({
    bucket: bucketLabel(p.bucket, data.grain),
    views: p.views,
    visitors: p.visitors,
  }));
  const drawVisitors = !bots && data.timeline.some((p) => p.visitors !== null);
  const chartConfig = {
    views: { label: tr("insights.column.views"), color: "var(--chart-2)" },
    visitors: {
      label: tr("insights.column.visitors"),
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  return (
    <div className="flex flex-col gap-4 p-4">
      {controls}
      <AppAnalyticsDimensionDialog
        dimension={openDimension}
        onClose={() => patch({})}
        onPick={pick}
      />

      <p className="text-sm" data-testid="insights-window">
        <span className="font-medium">{windowLabel(tr, l, data)}</span>
        {compare && (
          <span className="text-muted-foreground ml-2">
            {tr("insights.window.compared")}
          </span>
        )}
      </p>

      {errorLine}

      {!bots && (data.visitorsFrom || totals.visitors === null) && (
        <Alert data-testid="insights-views-only">
          <Info />
          <AlertDescription>
            {data.visitorsFrom
              ? tr("insights.viewsOnly.from", {
                  args: [day(data.visitorsFrom)],
                })
              : tr("insights.viewsOnly.window")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <AppAnalyticsTile
          testId="insights-visitors"
          icon={Users}
          title={tr("insights.uniqueVisitors")}
          value={viewsOnly ? null : totals.visitors}
          previous={viewsOnly ? undefined : previous?.visitors}
          format={(n) => l(n)}
          marker={
            !viewsOnly && sumReason ? (
              <UiTooltip>
                <TooltipTrigger
                  render={
                    <span
                      data-testid="insights-visitors-sum"
                      aria-label={sumReason}
                      className="text-muted-foreground cursor-help text-xl font-semibold"
                    />
                  }
                >
                  Σ
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {sumReason}
                </TooltipContent>
              </UiTooltip>
            ) : undefined
          }
          notes={visitorNotes}
        />
        <AppAnalyticsTile
          testId="insights-visits"
          icon={Route}
          title={tr("insights.visits")}
          value={viewsOnly ? null : totals.visits}
          previous={viewsOnly ? undefined : previous?.visits}
          format={(n) => l(n)}
        />
        <AppAnalyticsTile
          testId="insights-views"
          icon={Eye}
          title={tr("insights.views")}
          value={totals.views}
          previous={previous?.views}
          format={(n) => l(n)}
          extra={
            <AppAnalyticsEstimatedBadge
              estimated={data.estimated}
              sampleInterval={data.sampleInterval}
            />
          }
        />
        <AppAnalyticsTile
          testId="insights-bounce"
          icon={MousePointerClick}
          title={tr("insights.bounce")}
          tooltip={tr("insights.bounce.tooltip")}
          value={viewsOnly ? null : totals.bounceRate}
          previous={viewsOnly ? undefined : previous?.bounceRate}
          format={(n) => `${Math.round(n * 100)}%`}
          // A falling bounce rate is the good direction.
          invert
        />
        <AppAnalyticsTile
          testId="insights-duration"
          icon={Clock}
          title={tr("insights.duration")}
          tooltip={tr("insights.duration.tooltip")}
          value={viewsOnly ? null : totals.avgVisitSeconds}
          previous={viewsOnly ? undefined : previous?.avgVisitSeconds}
          format={(n) => duration(tr, n)}
        />
      </div>

      <Card data-testid="insights-chart">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4" />
            {tr(
              drawVisitors
                ? CHART_TITLE.both[data.grain]
                : CHART_TITLE.views[data.grain],
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[240px] w-full"
            >
              <ComposedChart data={timeline}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="views"
                  fill="var(--color-views)"
                  radius={[4, 4, 0, 0]}
                />
                {drawVisitors && (
                  <Line
                    dataKey="visitors"
                    type="monotone"
                    stroke="var(--color-visitors)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                )}
              </ComposedChart>
            </ChartContainer>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {tr("insights.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AppAnalyticsLeaderboard
          testId="insights-top-paths"
          onPick={pick}
          showVisitors={!viewsOnly}
          segments={segments(
            {
              dimension: "path",
              title: tr("insights.tab.pages"),
              rows: board("path"),
            },
            {
              dimension: "entry",
              title: tr("insights.tab.entry"),
              note: tr("insights.topEntryPaths.note"),
              rows: board("entry"),
            },
            {
              dimension: "exit",
              title: tr("insights.tab.exit"),
              rows: board("exit"),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-referrers"
          onPick={pick}
          showVisitors={!viewsOnly}
          segments={segments(
            {
              dimension: "referrer",
              title: tr("insights.tab.sources"),
              note: tr("insights.topReferrers.note"),
              rows: board("referrer", (value) =>
                value === "direct" ? tr("insights.topReferrers.direct") : value,
              ),
            },
            {
              dimension: "campaign",
              title: tr("insights.topCampaigns"),
              note: tr("insights.topCampaigns.note"),
              rows: board("campaign", (value) =>
                value === "none" ? tr("insights.topCampaigns.untagged") : value,
              ),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-devices"
          onPick={pick}
          showVisitors={!viewsOnly}
          segments={segments(
            {
              dimension: "device",
              title: tr("insights.topDevices"),
              rows: board("device", (value) => deviceLabel(tr, value)),
            },
            {
              dimension: "browser",
              title: tr("insights.topBrowsers"),
              rows: board("browser"),
            },
            {
              dimension: "os",
              title: tr("insights.topSystems"),
              rows: board("os"),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-countries"
          onPick={pick}
          showVisitors={!viewsOnly}
          segments={segments(
            {
              dimension: "country",
              title: tr("insights.tab.countries"),
              rows: board("country", (value) => `${flagEmoji(value)} ${value}`),
            },
            {
              dimension: "network",
              title: tr("insights.topNetworks"),
              rows: board("network"),
            },
          )}
        />
      </div>
    </div>
  );
};

/**
 * Why the visitor count is a sum, or `undefined` when it is a true distinct
 * count.
 */
const visitorsSumReason = (
  tr: Tr,
  data: InsightsResource,
): string | undefined => {
  if (data.visitorsSpanPeriods && data.visitorsSpanApps) {
    return tr("insights.visitors.sum.both");
  }
  if (data.visitorsSpanPeriods) return tr("insights.visitors.sum.periods");
  if (data.visitorsSpanApps) return tr("insights.visitors.sum.apps");
  return undefined;
};

/**
 * The window in words: "November 2026, to date", "October 2026", or two
 * days.
 */
const windowLabel = (tr: Tr, l: L, data: InsightsResource): string => {
  const from = new Date(data.from);
  const last = new Date(Date.parse(data.to) - 1);
  const utc = (value: Date, date: Intl.DateTimeFormatOptions) =>
    l(value, { timezone: "UTC", date });
  if (data.range === "thisMonth") {
    return tr("insights.window.toDate", {
      args: [utc(from, { month: "long", year: "numeric" })],
    });
  }
  if (data.range === "lastMonth") {
    return utc(from, { month: "long", year: "numeric" });
  }
  if (data.range === "thisYear") {
    return tr("insights.window.toDate", {
      args: [utc(from, { year: "numeric" })],
    });
  }
  const long = { day: "numeric", month: "long", year: "numeric" } as const;
  if (data.since === data.until) return utc(from, long);
  return `${utc(from, long)} - ${utc(last, long)}`;
};

/**
 * A bucket key as an axis tick: the hour, the day, or the month.
 */
const bucketLabel = (bucket: string, grain: Grain): string => {
  if (grain === "hour") return `${bucket.slice(11, 13)}:00`;
  if (grain === "month") return bucket.slice(0, 7);
  return bucket.slice(5, 10);
};

/**
 * Seconds as the tile reads them: `45s`, `2m 10s`, `1h 5m`.
 */
const duration = (tr: Tr, seconds: number): string => {
  const total = Math.round(seconds);
  if (total < 60) return tr("insights.duration.s", { args: [String(total)] });
  if (total < 3600) {
    return tr("insights.duration.ms", {
      args: [String(Math.floor(total / 60)), String(total % 60)],
    });
  }
  return tr("insights.duration.hm", {
    args: [
      String(Math.floor(total / 3600)),
      String(Math.floor((total % 3600) / 60)),
    ],
  });
};

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const CHART_TITLE = {
  both: {
    hour: "insights.chart.both.hour",
    day: "insights.chart.both.day",
    week: "insights.chart.both.week",
    month: "insights.chart.both.month",
  },
  views: {
    hour: "insights.chart.views.hour",
    day: "insights.chart.views.day",
    week: "insights.chart.views.week",
    month: "insights.chart.views.month",
  },
} as const;

/**
 * The three device buckets under their own names.
 *
 * Literal keys rather than a template, so the i18n audit sees them, and a
 * fallback to the raw value so a fourth bucket introduced upstream renders as
 * itself instead of as a missing translation.
 */
const deviceLabel = (tr: Tr, device: string): string => {
  if (device === "mobile") return tr("insights.device.mobile");
  if (device === "tablet") return tr("insights.device.tablet");
  if (device === "desktop") return tr("insights.device.desktop");
  return device;
};

/**
 * ISO-3166 alpha-2 to its flag, by offsetting each letter into the regional
 * indicator block. `ZZ` (the edge did not say) and anything malformed get a
 * globe rather than a broken emoji.
 */
const flagEmoji = (code: string): string => {
  const cc = (code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === "ZZ") {
    return "🌐";
  }
  return String.fromCodePoint(
    0x1f1e6 + cc.charCodeAt(0) - 65,
    0x1f1e6 + cc.charCodeAt(1) - 65,
  );
};

export default AppAnalytics;
