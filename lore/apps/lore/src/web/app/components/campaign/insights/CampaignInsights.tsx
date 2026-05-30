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
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BarChart3, Eye, Info, Loader2, Users } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type {
  InsightsController,
  InsightsResource,
} from "@/api/controllers/InsightsController.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignInsightsProps {
  insights: InsightsResource;
}

type Range = "1d" | "7d" | "30d";
const RANGES: Range[] = ["1d", "7d", "30d"];

// Chart palette — `ChartContainer` exposes each key as a `--color-<key>`
// CSS variable so the bars track the theme + dark mode.
const viewsChartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

const countryChartConfig = {
  count: { label: "Views", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Convert an ISO-3166 alpha-2 code to its flag emoji (regional indicator
 * symbols). `ZZ` / unknown / malformed codes get a globe glyph instead of a
 * broken emoji — the ingestion stores `ZZ` when `cf-ipcountry` is absent.
 */
function flagEmoji(code: string): string {
  const cc = (code || "").toUpperCase();
  if (cc === "ZZ" || !/^[A-Z]{2}$/.test(cc)) {
    return "🌐";
  }
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const CampaignInsights = (props: CampaignInsightsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const insightsApi = useClient<InsightsController>();
  const toaster = useToast();

  const [data, setData] = useState<InsightsResource>(props.insights);
  const [range, setRange] = useState<Range>(props.insights.range ?? "7d");
  const [loading, setLoading] = useState(false);

  const changeRange = async (next: Range) => {
    if (!campaign || next === range) return;
    const previous = range;
    setRange(next);
    setLoading(true);
    try {
      const res = await insightsApi.getInsights({
        params: { campaignId: campaign.id },
        query: { range: next },
      });
      setData(res);
    } catch (error: any) {
      // A failed range fetch leaves stale data — surface it via a toast and
      // roll the range toggle back so it matches the data actually shown.
      setRange(previous);
      toaster.show(error?.message || tr("insights.error"), "danger");
    } finally {
      setLoading(false);
    }
  };

  const countryData = data.topCountries.map((c) => ({
    label: `${flagEmoji(c.country)} ${c.country}`,
    count: c.count,
  }));
  const timelineData = data.timeline.map((p) => ({
    date: p.date.slice(5),
    views: p.views,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Header + range toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{tr("insights.title")}</h2>
            {loading && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {tr("insights.subtitle")}
          </p>
        </div>
        <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => void changeRange(r)}
              className={
                r === range
                  ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                  : "text-muted-foreground rounded px-3 py-1 text-xs"
              }
            >
              {tr(`insights.range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Unique visitors — the trustworthy headline. */}
        <Card>
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
        <Card>
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
        <Card>
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
    </div>
  );
};

export default CampaignInsights;
