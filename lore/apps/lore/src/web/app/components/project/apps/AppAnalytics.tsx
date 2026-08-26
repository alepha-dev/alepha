import {
  Card,
  CardContent,
  CardDescription,
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
import {
  BarChart3,
  DoorOpen,
  Eye,
  Info,
  MousePointerClick,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { currentSigilInsightsAtom } from "../../../atoms/currentSigilInsightsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";

// Chart palette — `ChartContainer` exposes each key as a `--color-<key>`
// CSS variable so the bars track the theme + dark mode.
const viewsChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

const countryChartConfig = {
  count: { label: "Views", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Privacy-first pageview analytics for one app: unique visitors, total views,
 * the views timeline, top countries and top pages. The "Analytics" tab of the
 * app page.
 *
 * Reads `currentSigilInsightsAtom` rather than taking the data as a prop: the
 * range toggle lives on the layout above, and a `NestedView` child is handed an
 * element it cannot receive fresh props through. The atom is written by the
 * `projectApp` loader before this ever renders, and rewritten by the toggle.
 */
const AppAnalytics = () => {
  const { tr } = useI18n<I18n, "en">();
  const [data] = useStore(currentSigilInsightsAtom);

  if (!data) {
    return null;
  }

  const countryData = data.topCountries.map((c) => ({
    label: `${flagEmoji(c.country)} ${c.country}`,
    count: c.count,
  }));
  const timelineData = data.timeline.map((p) => ({
    date: p.date.slice(5),
    views: p.views,
  }));

  return (
    <div className="flex flex-col gap-4">
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
            <div className="text-3xl font-bold tabular-nums">
              {data.uniqueVisitors.toLocaleString()}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.uniqueVisitors.note")}
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

        {/* The number automation does not inflate by accident. */}
        <Card data-testid="insights-engagement">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <MousePointerClick className="size-4" />
              {tr("insights.engagement")}
              <UiTooltip>
                <TooltipTrigger
                  render={<Info className="size-3.5 cursor-help opacity-70" />}
                />
                <TooltipContent className="max-w-xs">
                  {tr("insights.engagement.tooltip")}
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {data.engagementRate}%
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("insights.engagement.note")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Views over time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-5" />
            {tr("insights.overTime")}
          </CardTitle>
          <AppAnalyticsEstimatedBadge
            estimated={data.estimated}
            sampleInterval={data.sampleInterval}
          />
        </CardHeader>
        <CardContent>
          {data.totalViews > 0 ? (
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
                  width={32}
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Top countries */}
        <Card data-testid="insights-countries">
          <CardHeader>
            <CardTitle className="text-base">
              {tr("insights.topCountries")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {countryData.length > 0 ? (
              <ChartContainer
                config={countryChartConfig}
                className="aspect-auto h-[220px] w-full"
              >
                <BarChart data={countryData} layout="vertical">
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={80}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[0, 4, 4, 0]}
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

        {/* Top paths */}
        <Card data-testid="insights-top-paths">
          <CardHeader>
            <CardTitle className="text-base">
              {tr("insights.topPaths")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topPaths.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.topPaths.map((p) => (
                  <div key={p.path} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-mono text-xs">
                        {p.path}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {p.count.toLocaleString()} · {p.percentage}%
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
                      <div
                        className="bg-primary h-full rounded"
                        style={{ width: `${p.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {tr("insights.empty")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Landing pages — `topPaths` cannot answer this, see the controller. */}
        <Card data-testid="insights-entry-paths">
          <CardHeader>
            <CardTitle className="text-base">
              {tr("insights.topEntryPaths")}
            </CardTitle>
            <CardDescription>
              {tr("insights.topEntryPaths.note")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.topEntryPaths.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.topEntryPaths.map((p) => (
                  <div key={p.path} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-mono text-xs">
                        {p.path}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {p.count.toLocaleString()} · {p.percentage}%
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
                      <div
                        className="bg-primary h-full rounded"
                        style={{ width: `${p.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {tr("insights.empty")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Campaigns and devices share a card: both are short lists. */}
        <Card data-testid="insights-campaigns">
          <CardHeader>
            <CardTitle className="text-base">
              {tr("insights.topCampaigns")}
            </CardTitle>
            <CardDescription>
              {tr("insights.topCampaigns.note")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <AppAnalyticsTally
              rows={data.topCampaigns.map((c) => ({
                key: c.campaign,
                label:
                  c.campaign === "none"
                    ? tr("insights.topCampaigns.untagged")
                    : c.campaign,
                count: c.count,
              }))}
              emptyLabel={tr("insights.empty")}
            />
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs font-medium">
                {tr("insights.topDevices")}
              </p>
              <AppAnalyticsTally
                rows={data.topDevices.map((d) => ({
                  key: d.device,
                  label: tr(`insights.device.${d.device}` as never),
                  count: d.count,
                }))}
                emptyLabel={tr("insights.empty")}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top referrers */}
      <Card data-testid="insights-referrers">
        <CardHeader>
          <CardTitle className="text-base">
            {tr("insights.topReferrers")}
          </CardTitle>
          <CardDescription>{tr("insights.topReferrers.note")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.topReferrers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {data.topReferrers.map((r) => (
                <div key={r.referrer} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-mono text-xs">
                      {r.referrer === "direct"
                        ? tr("insights.topReferrers.direct")
                        : r.referrer}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {r.count.toLocaleString()} · {r.percentage}%
                    </span>
                  </div>
                  <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
                    <div
                      className="bg-primary h-full rounded"
                      style={{ width: `${r.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {tr("insights.empty")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

interface AppAnalyticsTallyProps {
  rows: Array<{ key: string; label: string | number; count: number }>;
  emptyLabel: string;
}

/**
 * A plain label/count list, for leaderboards short enough that a bar chart
 * would be decoration. Shared by the campaign and device lists, which have at
 * most a handful of rows each.
 */
const AppAnalyticsTally = (props: AppAnalyticsTallyProps) => {
  if (props.rows.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        {props.emptyLabel}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {props.rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="truncate">{row.label}</span>
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {row.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * Convert an ISO-3166 alpha-2 code to its flag emoji (regional indicator
 * symbols). `ZZ` / unknown / malformed codes get a globe glyph instead of a
 * broken emoji — the ingest stores `ZZ` when the edge did not say.
 */
const flagEmoji = (code: string): string => {
  const cc = (code || "").toUpperCase();
  if (cc === "ZZ" || !/^[A-Z]{2}$/.test(cc)) {
    return "🌐";
  }
  return String.fromCodePoint(
    // A two-letter ISO country code, ASCII by construction — the emoji the rule
    // warns about is what this builds, not what it consumes.
    // oxlint-disable-next-line typescript/no-misused-spread
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
};

export default AppAnalytics;
