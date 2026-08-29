import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import {
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  BarChart3,
  Bug,
  DoorOpen,
  Eye,
  Info,
  MousePointerClick,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { InsightsDimensionResource } from "@/api/schemas/insightsDimensionResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";
import AppAnalyticsFilterChips from "./AppAnalyticsFilterChips.tsx";
import AppAnalyticsLeaderboard, {
  type AppAnalyticsLeaderboardSegment,
} from "./AppAnalyticsLeaderboard.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { type AppInsightsFilterKey, useAppInsights } from "./useAppInsights.ts";

// Chart palette — `ChartContainer` exposes each key as a `--color-<key>`
// CSS variable so the bars track the theme + dark mode.
const viewsChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Which leaderboard row sets which filter.
 *
 * `entryPath` is the one that is not its own filter: it groups by `path` and
 * differs only in the measure, so narrowing to a landing page is narrowing to
 * that path.
 */
const ROW_FILTER: Record<
  InsightsDimensionResource["dimension"],
  AppInsightsFilterKey
> = {
  country: "country",
  path: "path",
  entryPath: "path",
  campaign: "campaign",
  device: "device",
  referrer: "referrer",
  browser: "browser",
  os: "os",
};

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
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);
  const { data, loading, error, range, traffic, filters, setFilters } =
    useAppInsights();

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

  if (!data || !project || !sigil) {
    return (
      <div className="flex flex-col gap-4">
        {controls}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {tr("insights.error")}
          </p>
        )}
      </div>
    );
  }

  const params = { projectSlug: project.slug, appName: sigil.name };
  const detailHref = (dimension: InsightsDimensionResource["dimension"]) =>
    router.path("appAnalyticsDimension", {
      params: { ...params, analyticsDimension: dimension },
      query: { ...filters, range, traffic },
    });

  const pick = (
    dimension: InsightsDimensionResource["dimension"],
    value: string,
  ) =>
    setFilters({ ...filters, range, traffic, [ROW_FILTER[dimension]]: value });

  /**
   * A row's share of the window's views, whole percent.
   *
   * Out of `totalViews` rather than out of the leaderboard, which is the only
   * denominator that makes two cards comparable: a bar whose 100% meant "the
   * top of this list" would read as dominance on a board with one row.
   */
  const share = (count: number) =>
    data.totalViews > 0 ? Math.round((count / data.totalViews) * 100) : 0;

  const timelineData = data.timeline.map((p) => ({
    date: p.date.slice(5),
    views: p.views,
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
  const bounce = 100 - data.engagementRate;

  const delta = data.uniqueVisitorsDelta;
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
    ...list: Array<Omit<AppAnalyticsLeaderboardSegment, "href">>
  ): AppAnalyticsLeaderboardSegment[] =>
    list.map((entry) => ({ ...entry, href: detailHref(entry.dimension) }));

  return (
    <div className="flex flex-col gap-4">
      {controls}

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
                {data.uniqueVisitors.toLocaleString()}
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
              {/*
                The payload names any filter this count could not honour, and
                it is rendered rather than swallowed: a project-wide visitor
                figure sitting under filtered views with nothing on screen
                saying so is the exact lie `uniqueVisitorsIgnores` exists to
                prevent.
              */}
              {data.uniqueVisitorsIgnores.length > 0
                ? tr("insights.uniqueVisitors.unfiltered", {
                    args: [data.uniqueVisitorsIgnores.join(", ")],
                  })
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
              {data.totalViews.toLocaleString()}
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

        {/* Page loads, as opposed to every client-side navigation. */}
        <Card data-testid="insights-entries">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <DoorOpen className="size-4" />
              {tr("insights.entries")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {data.entries.toLocaleString()}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.entries.note")}
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

      {/*
        The error budget, off the metric row on purpose: it is not a traffic
        number, and reading it beside four of them invites a comparison that
        means nothing. Per app, which is the question the Blights inbox cannot
        answer — it keys on `(project, fingerprint)` so a triage decision does
        not fork, and that merges every enrolled app into one row.
      */}
      <Card data-testid="insights-errors">
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Bug className="text-muted-foreground size-4" />
          <span className="font-semibold tabular-nums">
            {data.errorGroups.length.toLocaleString()}
          </span>
          <span className="text-muted-foreground">
            {tr("insights.errors.note")}
          </span>
          <Link
            href={router.path("projectBlights", {
              params: { projectSlug: project.slug },
            })}
            className="text-muted-foreground hover:text-foreground ml-auto text-xs transition-colors"
          >
            {tr("insights.errors.inbox")}
          </Link>
        </CardContent>
      </Card>

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
              title: String(tr("insights.topPaths")),
              rows: data.topPaths.map((row) => ({
                value: row.path,
                label: row.path,
                count: row.count,
                percentage: row.percentage,
              })),
            },
            {
              dimension: "entryPath",
              title: String(tr("insights.topEntryPaths")),
              note: String(tr("insights.topEntryPaths.note")),
              rows: data.topEntryPaths.map((row) => ({
                value: row.path,
                label: row.path,
                count: row.count,
                percentage: row.percentage,
              })),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-referrers"
          onPick={pick}
          segments={segments(
            {
              dimension: "referrer",
              title: String(tr("insights.topReferrers")),
              note: String(tr("insights.topReferrers.note")),
              rows: data.topReferrers.map((row) => ({
                value: row.referrer,
                // `direct` is a sentinel bucket, not a host, and it is the
                // denominator rather than a source: without it on the same
                // board, "12 views from Hacker News" reads as a share of the
                // referred traffic rather than of the traffic.
                label:
                  row.referrer === "direct"
                    ? String(tr("insights.topReferrers.direct"))
                    : row.referrer,
                count: row.count,
                percentage: row.percentage,
              })),
            },
            {
              dimension: "campaign",
              title: String(tr("insights.topCampaigns")),
              note: String(tr("insights.topCampaigns.note")),
              rows: data.topCampaigns.map((row) => ({
                value: row.campaign,
                label:
                  row.campaign === "none"
                    ? String(tr("insights.topCampaigns.untagged"))
                    : row.campaign,
                count: row.count,
                // Out of `entries`, not `totalViews`: a campaign describes how
                // a visit began, so the share it holds is a share of arrivals.
                percentage:
                  data.entries > 0
                    ? Math.round((row.count / data.entries) * 100)
                    : 0,
              })),
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
              title: String(tr("insights.topDevices")),
              rows: data.topDevices.map((row) => ({
                value: row.device,
                label: deviceLabel(tr, row.device),
                count: row.count,
                percentage: share(row.count),
              })),
            },
            {
              dimension: "browser",
              title: String(tr("insights.topBrowsers")),
              rows: data.topBrowsers.map((row) => ({
                value: row.browser,
                label: row.browser,
                count: row.count,
                percentage: share(row.count),
              })),
            },
            {
              dimension: "os",
              title: String(tr("insights.topSystems")),
              rows: data.topSystems.map((row) => ({
                value: row.os,
                label: row.os,
                count: row.count,
                percentage: share(row.count),
              })),
            },
          )}
        />

        <AppAnalyticsLeaderboard
          testId="insights-countries"
          onPick={pick}
          segments={segments({
            dimension: "country",
            title: String(tr("insights.topCountries")),
            rows: data.topCountries.map((row) => ({
              value: row.country,
              label: `${flagEmoji(row.country)} ${row.country}`,
              count: row.count,
              percentage: share(row.count),
            })),
          })}
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
  if (device === "mobile") return String(tr("insights.device.mobile"));
  if (device === "tablet") return String(tr("insights.device.tablet"));
  if (device === "desktop") return String(tr("insights.device.desktop"));
  return device;
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
