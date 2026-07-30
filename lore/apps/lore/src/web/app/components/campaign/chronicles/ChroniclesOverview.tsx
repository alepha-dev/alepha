import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import type { Static } from "alepha";
import { useI18n } from "alepha/react/i18n";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type { chroniclesOverviewSchema } from "@/api/schemas/chroniclesSchemas.ts";
import type { I18n } from "../../../services/I18n.ts";
import ChroniclesKpiRow, { type ChroniclesKpi } from "./ChroniclesKpiRow.tsx";
import ChroniclesSection from "./ChroniclesSection.tsx";

type ChroniclesOverview = Static<typeof chroniclesOverviewSchema>;

export interface ChroniclesOverviewProps {
  overview: ChroniclesOverview;
}

/**
 * Chronicles "Overview" page — a flat dashboard of campaign-wide quest health:
 * KPI row, burn-up area chart, completion-rate line chart, and an understated
 * attention strip. Receives the loader result directly as `props.overview`.
 */
const ChroniclesOverview = (props: ChroniclesOverviewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { kpis, burnup, completionTrend, attention } = props.overview;

  // Chart palettes — keys match the recharts `dataKey`s; `ChartContainer`
  // turns each into a `--color-<key>` CSS variable so series track the theme.
  // Built in-body so labels can be translated via `tr`.
  const burnupChartConfig = {
    created: {
      label: tr("chronicles.overview.chart.created"),
      color: "var(--chart-3)",
    },
    completed: {
      label: tr("chronicles.overview.chart.completed"),
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  const completionChartConfig = {
    rate: {
      label: tr("chronicles.overview.chart.completionRate"),
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;

  const completionPct = Math.round(
    (kpis.completedQuests / Math.max(kpis.totalQuests, 1)) * 100,
  );
  const weekDelta = kpis.completedThisWeek - kpis.completedLastWeek;
  const cycleTime =
    kpis.avgCycleTimeHours >= 48
      ? `${Math.round(kpis.avgCycleTimeHours / 24)}d`
      : `${Math.round(kpis.avgCycleTimeHours)}h`;

  const kpiRow: ChroniclesKpi[] = [
    {
      label: tr("chronicles.overview.kpi.completion"),
      value: `${completionPct}%`,
      hint: String(
        tr("chronicles.overview.kpi.completionHint", {
          args: [String(kpis.completedQuests), String(kpis.totalQuests)],
        }),
      ),
    },
    {
      label: tr("chronicles.overview.kpi.open"),
      value: kpis.openQuests,
    },
    {
      label: tr("chronicles.overview.kpi.completedThisWeek"),
      value: kpis.completedThisWeek,
      hint: String(
        tr("chronicles.overview.kpi.weekDeltaHint", {
          args: [`${weekDelta >= 0 ? "+" : ""}${weekDelta}`],
        }),
      ),
    },
    {
      label: tr("chronicles.overview.kpi.cycleTime"),
      value: cycleTime,
    },
    {
      label: tr("chronicles.overview.kpi.activeMembers"),
      value: kpis.activeMembers,
    },
  ];

  const attentionItems = [
    {
      count: attention.staleQuests,
      label: tr("chronicles.overview.attention.stale"),
    },
    {
      count: attention.unassignedQuests,
      label: tr("chronicles.overview.attention.unassigned"),
    },
    {
      count: attention.blockedQuests,
      label: tr("chronicles.overview.attention.blocked"),
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="flex flex-col gap-8">
      <ChroniclesKpiRow kpis={kpiRow} />

      <ChroniclesSection title={tr("chronicles.overview.burnup.title")}>
        {burnup.length > 0 ? (
          <ChartContainer
            config={burnupChartConfig}
            className="aspect-auto h-[260px] w-full"
          >
            <AreaChart data={burnup}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="created"
                stroke="var(--color-created)"
                fill="var(--color-created)"
                fillOpacity={0.2}
              />
              <Area
                type="monotone"
                dataKey="completed"
                stroke="var(--color-completed)"
                fill="var(--color-completed)"
                fillOpacity={0.2}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.overview.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection title={tr("chronicles.overview.completionRate.title")}>
        {completionTrend.length > 0 ? (
          <ChartContainer
            config={completionChartConfig}
            className="aspect-auto h-[200px] w-full"
          >
            <LineChart data={completionTrend}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="var(--color-rate)"
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.overview.empty")}
          </p>
        )}
      </ChroniclesSection>

      {attentionItems.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("chronicles.overview.attention.none")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {attentionItems.map((item) => (
            <span key={item.label}>
              <span className="font-semibold tabular-nums">{item.count}</span>{" "}
              <span className="text-muted-foreground">{item.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChroniclesOverview;
