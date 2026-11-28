import {
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
  Route,
  Eye,
  Info,
  MousePointerClick,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { InsightsDimensionResource } from "../../../../../api/schemas/insightsDimensionResourceSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { ANALYTICS_DIMENSIONS } from "./analyticsDimensions.ts";
import AppAnalyticsDimensionDialog from "./AppAnalyticsDimensionDialog.tsx";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";
import AppAnalyticsFilterChips from "./AppAnalyticsFilterChips.tsx";
import AppAnalyticsLeaderboard, {
  type AppAnalyticsLeaderboardSegment,
} from "./AppAnalyticsLeaderboard.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { APP_INSIGHTS_ROW_FILTER, useAppInsights } from "./useAppInsights.ts";

// Chart palette — `ChartContainer` exposes each key as a `--color-<key>`
// CSS variable so the bars track the theme + dark mode.
const viewsChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Privacy-first pageview analytics for one app, in one dense overview.
 *
 * It used to be a column of eight equal cards, which made it a list of things
 * rather than a shape a reader could take in. The order now is the order the
 * questions are asked in: what am I looking at (the controls and the chips),
 * how much of it is there (the metric row), when did it happen (the chart),
 * and where did it come from (the leaderboards).
 *
 * **Clicking a leaderboard row filters the whole page.** That is the
 * interaction the section exists for, and the leaderboards are how you reach
 * it. Everything narrows together, because the filter rides in the URL and the
 * whole payload is fetched under it.
 *
 * ⚠️ The traffic control is NOT one of the chips, deliberately. See
 * {@link AppAnalyticsFilterChips} for the reasoning; the short version is that
 * it is a mode rather than a value, and it is the only narrowing
 * `uniqueVisitors` can honour.
 */
const AppAnalytics = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const {
    data,
    loading,
    error,
    range,
    traffic,
    filters,
    setFilters,
    leaderboard,
  } = useAppInsights();

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <AppAnalyticsFilterChips
        filters={filters}
        onClear={(key) => setFilters({ ...filters, range, traffic, [key]: "" })}
        onClearAll={() => setFilters({ range, traffic })}
      />
      <AppInsightsControls
        range={range}
        traffic={traffic}
        loading={loading}
        showTraffic
        onChange={(next) => setFilters({ ...filters, ...next })}
      />
    </div>
  );

  if (!data || !project || !instance) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {controls}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {tr("insights.error")}
          </p>
        )}
      </div>
    );
  }

  // A leaderboard's full list opens in a dialog over the tab (#Q3674),
  // named in the URL so a reload or a link reopens it. Picking a row, like
  // closing, drops it from the URL.
  const openLeaderboard = (dimension: InsightsDimensionResource["dimension"]) =>
    setFilters({ ...filters, range, traffic, leaderboard: dimension });
  const closeLeaderboard = () => setFilters({ ...filters, range, traffic });
  const openDimension = ANALYTICS_DIMENSIONS.has(leaderboard ?? "")
    ? (leaderboard as InsightsDimensionResource["dimension"])
    : undefined;

  const pick = (
    dimension: InsightsDimensionResource["dimension"],
    value: string,
  ) =>
    setFilters({
      ...filters,
      range,
      traffic,
      [APP_INSIGHTS_ROW_FILTER[dimension]]: value,
    });

  /**
   * A row's share of the window's views, whole percent.
   *
   * Out of `totalViews` rather than out of the leaderboard, which is the only
   * denominator that makes two cards comparable: a bar whose 100% meant "the
   * top of this list" would read as dominance on a board with one row.
   */
  const totalViews = data.totals.views ?? 0;
  const share = (count: number) =>
    totalViews > 0 ? Math.round((count / totalViews) * 100) : 0;

  const timelineData = data.timeline.map((p) => ({
    date: p.bucket.slice(5),
    views: p.views,
  }));

  /**
   * One leaderboard of the response as the cards draw it: views per value,
   * as a share of the window's views.
   */
  const board = (
    dimension: keyof typeof data.leaderboards,
    label: (value: string) => string = (value) => value,
  ) =>
    data.leaderboards[dimension].map((row) => ({
      value: row.value,
      label: label(row.value),
      count: row.views,
      percentage: share(row.views),
    }));

  /**
   * The share of views that showed no signal of a reader.
   *
   * The complement of the engagement rate, and named honestly: it is NOT a
   * session-based bounce rate, which would need sessions this store does not
   * keep. What it counts is views nobody scrolled, clicked or stayed on, which
   * is the closest thing the data supports and the one number automation
   * cannot inflate by accident. The tooltip says so rather than leaving the
   * reader to assume the usual definition.
   */
  const bounce = Math.round((data.totals.bounceRate ?? 0) * 100);

  const visitors = data.totals.visitors;
  const previousVisitors = data.previous?.totals.visitors;
  const delta =
    visitors !== null &&
    previousVisitors !== null &&
    previousVisitors !== undefined &&
    previousVisitors > 0
      ? Math.round(((visitors - previousVisitors) / previousVisitors) * 100)
      : undefined;
  /**
   * A delta is only honest between two windows of the same width.
   *
   * `1d` ends mid-day, so today-so-far against a complete yesterday compares
   * different-sized things: it reads as a collapse every morning and recovers
   * by dinner, because the number moved when the clock did. Over 7 or 30 days
   * the partial day is a seventh or a thirtieth of the window and the
   * direction survives it, which the tooltip states.
   */
  const showDelta = delta !== undefined && range !== "1d";

  const segments = (
    ...list: Array<Omit<AppAnalyticsLeaderboardSegment, "onMore">>
  ): AppAnalyticsLeaderboardSegment[] =>
    list.map((entry) => ({
      ...entry,
      onMore: () => openLeaderboard(entry.dimension),
    }));

  return (
    <div className="flex flex-col gap-4 p-4">
      {controls}
      <AppAnalyticsDimensionDialog
        dimension={openDimension}
        onClose={closeLeaderboard}
        onPick={pick}
      />

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {tr("insights.error")}
        </p>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Unique visitors — the trustworthy headline. */}
        <Card data-testid="insights-unique-visitors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Users className="size-4" />
              {tr("insights.uniqueVisitors")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                {visitors === null ? "-" : visitors.toLocaleString()}
              </span>
              {/*
                The comparison the endpoint has answered since 2026-08-21 with
                nothing reading it. On uniques and not on views, deliberately:
                a delta amplifies whatever noise is in both windows, so it
                belongs on the number a token-holder cannot inflate.
              */}
              {showDelta && (
                <UiTooltip>
                  <TooltipTrigger
                    render={
                      <span
                        data-testid="insights-visitors-delta"
                        className={`inline-flex cursor-help items-center gap-1 text-xs font-medium ${
                          (delta ?? 0) < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      />
                    }
                  >
                    {(delta ?? 0) < 0 ? (
                      <TrendingDown className="size-3.5" />
                    ) : (
                      <TrendingUp className="size-3.5" />
                    )}
                    {`${(delta ?? 0) > 0 ? "+" : ""}${delta}%`}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {tr("insights.delta.tooltip")}
                  </TooltipContent>
                </UiTooltip>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {data.peopleOnly
                ? tr("insights.uniqueVisitors.peopleOnly")
                : tr("insights.uniqueVisitors.note")}
            </p>
          </CardContent>
        </Card>

        {/* Total views — best-effort / directional. */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Eye className="size-4" />
              {tr("insights.totalViews")}
              <UiTooltip>
                <TooltipTrigger
                  render={<Info className="size-3.5 cursor-help opacity-70" />}
                />
                <TooltipContent className="max-w-xs">
                  {tr("insights.totalViews.tooltip")}
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {totalViews.toLocaleString()}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.totalViews.note")}
            </p>
            <AppAnalyticsEstimatedBadge
              estimated={data.estimated}
              sampleInterval={data.sampleInterval}
            />
          </CardContent>
        </Card>

        {/* Visits: runs of views closed by 30 minutes without one. */}
        <Card data-testid="insights-visits">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Route className="size-4" />
              {tr("insights.visits")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {data.totals.visits === null
                ? "-"
                : data.totals.visits.toLocaleString()}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.visits.note")}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="insights-bounce">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <MousePointerClick className="size-4" />
              {tr("insights.bounce")}
              <UiTooltip>
                <TooltipTrigger
                  render={<Info className="size-3.5 cursor-help opacity-70" />}
                />
                <TooltipContent className="max-w-xs">
                  {tr("insights.bounce.tooltip")}
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">{bounce}%</div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.bounce.note")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* The error budget used to sit here, off the metric row (#1215). It has
          its own tab now: an error budget is not a traffic number, and as a
          card it was a bare count whose only action was a link to the
          project-wide inbox. See `AppErrors.tsx` for why a tab rather than a
          deletion or a move back to the Dashboard (feedback #2080). */}

      {/* Views over time, full width. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4" />
            {tr("insights.overTime")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timelineData.length > 0 ? (
            <ChartContainer
              config={viewsChartConfig}
              className="aspect-auto h-[240px] w-full"
            >
              <BarChart data={timelineData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
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
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {tr("insights.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Six segments, four cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AppAnalyticsLeaderboard
          testId="insights-top-paths"
          onPick={pick}
          segments={segments(
            {
              dimension: "path",
              title: tr("insights.topPaths"),
              rows: board("path"),
            },
            {
              dimension: "entry",
              title: tr("insights.topEntryPaths"),
              note: tr("insights.topEntryPaths.note"),
              rows: board("entry"),
            },
            {
              dimension: "exit",
              title: tr("insights.topExitPaths"),
              rows: board("exit"),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-referrers"
          onPick={pick}
          segments={segments(
            {
              dimension: "referrer",
              title: tr("insights.topReferrers"),
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

        {/*
          Three tabs rather than three cards: device, browser and OS are the
          same question asked three ways — what the visitor is reading on — and
          separating them would spend three cards on one row of the reader's
          attention.
        */}
        <AppAnalyticsLeaderboard
          testId="insights-devices"
          onPick={pick}
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
            {
              // A fourth segment rather than a stat tile of its own: it adds
              // no component, and it inherits `onPick`, so clicking "Signed
              // in" narrows the whole page to authenticated traffic. The
              // leaderboard already renders a share per row, which is the
              // number this was asked for.
              dimension: "auth",
              title: tr("insights.topAudience"),
              rows: board("auth", (value) => audienceLabel(tr, value)),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-countries"
          onPick={pick}
          segments={segments(
            {
              dimension: "country",
              title: tr("insights.topCountries"),
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
 * The three device buckets under their own names.
 *
 * Literal keys rather than a template, so the i18n audit sees them, and a
 * fallback to the raw value so a fourth bucket introduced upstream renders as
 * itself instead of as a missing translation.
 */
const deviceLabel = (
  tr: ReturnType<typeof useI18n<I18n, "en">>["tr"],
  device: string,
): string => {
  if (device === "mobile") return tr("insights.device.mobile");
  if (device === "tablet") return tr("insights.device.tablet");
  if (device === "desktop") return tr("insights.device.desktop");
  return device;
};

/**
 * `user` and `anon` under names a reader recognises.
 *
 * Literal keys rather than a template, so the i18n audit sees them, and a
 * fallback to the raw value for the same reason `deviceLabel` has one: a
 * third value arriving from a newer proxy renders as itself rather than as
 * an empty row.
 */
const audienceLabel = (
  tr: ReturnType<typeof useI18n<I18n, "en">>["tr"],
  auth: string,
): string => {
  if (auth === "user") return tr("insights.audience.user");
  if (auth === "anon") return tr("insights.audience.anon");
  return auth;
};

/**
 * ISO-3166 alpha-2 to its flag, by offsetting each letter into the regional
 * indicator block.
 *
 * `ZZ` (the edge did not say) and anything malformed get a globe rather than a
 * broken emoji, which is what two out-of-range code points render as.
 *
 * Indexed rather than spread: the code is two ASCII letters by construction,
 * but spreading a string is a lint error here for the general case, and the
 * general case is precisely the emoji this function BUILDS rather than
 * consumes. Reading the two characters directly sidesteps the argument.
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
