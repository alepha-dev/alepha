import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { ReportsPlanning } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportsReleaseBurnupProps {
  release: ReportsPlanning["releases"]["open"][number];
}

/**
 * One open release's burn-up, with its target and its forecast as dated lines.
 */
const ReportsReleaseBurnup = (props: ReportsReleaseBurnupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { release } = props;
  const config = {
    scope: { label: tr("reports.planning.scope"), color: "var(--chart-3)" },
    done: { label: tr("reports.planning.done"), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const marks = [
    { label: tr("reports.planning.target"), date: release.targetDate },
    { label: "p50", date: release.forecast?.p50 },
    { label: "p85", date: release.forecast?.p85 },
  ].flatMap((mark) =>
    mark.date ? [{ label: mark.label, date: mark.date.slice(0, 10) }] : [],
  );
  // Forecast dates lie past the last point, so the axis has to reach them.
  const data = [
    ...release.burnup,
    ...marks
      .filter((mark) => mark.date > (release.burnup.at(-1)?.date ?? ""))
      .map((mark) => ({ date: mark.date }))
      .toSorted((a, b) => a.date.localeCompare(b.date)),
  ];

  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {marks.map((mark) => (
          <ReferenceLine
            key={mark.label}
            x={mark.date}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: mark.label, position: "top", fontSize: 11 }}
          />
        ))}
        <Line
          dataKey="scope"
          stroke="var(--color-scope)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          dataKey="done"
          stroke="var(--color-done)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
};

export default ReportsReleaseBurnup;
