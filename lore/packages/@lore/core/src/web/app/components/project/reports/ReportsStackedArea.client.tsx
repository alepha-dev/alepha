import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

export interface ReportsStackedAreaProps {
  /**
   * One row per point: `date` and a value per series key.
   */
  data: Array<{ date: string } & Record<string, string | number | boolean>>;
  /**
   * The bands, bottom first. Each keeps its colour whatever the others do.
   */
  series: Array<{ key: string; label: string; color: string }>;
  onSelect?: (key: string) => void;
}

/**
 * Stacked bands over time (#Q2997), for a cumulative flow: their thickness is
 * the work in each state, and the top edge is the total.
 */
const ReportsStackedArea = (props: ReportsStackedAreaProps) => {
  const config = Object.fromEntries(
    props.series.map((it) => [it.key, { label: it.label, color: it.color }]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
      <AreaChart data={props.data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {props.series.map((it) => (
          <Area
            key={it.key}
            type="monotone"
            dataKey={it.key}
            stackId="flow"
            stroke={`var(--color-${it.key})`}
            fill={`var(--color-${it.key})`}
            fillOpacity={0.5}
            className={props.onSelect ? "cursor-pointer" : undefined}
            onClick={() => props.onSelect?.(it.key)}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
};

export default ReportsStackedArea;
