import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportsScatterPoint {
  /**
   * The point's date, `YYYY-MM-DD`.
   */
  date: string;
  value: number;
  label?: string;
}

export interface ReportsScatterChartProps<T extends ReportsScatterPoint> {
  points: T[];
  /**
   * Named horizontal lines: p50 and p85 on a cycle-time scatter.
   */
  lines?: Array<{ label: string; value: number }>;
  valueLabel: string;
  onSelect?: (point: T) => void;
}

/**
 * One dot per item against time (#Q2997). No category colour: a dot's position
 * is the data, and the reference lines are what a reader compares it with.
 */
const ReportsScatterChart = <T extends ReportsScatterPoint>(
  props: ReportsScatterChartProps<T>,
) => {
  const config = {
    value: { label: props.valueLabel, color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const data = props.points.map((point) => ({
    ...point,
    at: Date.parse(point.date),
  }));

  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <ScatterChart>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(at: number) =>
            new Date(at).toISOString().slice(0, 10)
          }
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis dataKey="value" tickLine={false} axisLine={false} width={40} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="label"
              labelFormatter={(_value, items) => items[0]?.payload?.label}
            />
          }
        />
        {props.lines?.map((line) => (
          <ReferenceLine
            key={line.label}
            y={line.value}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: line.label,
              position: "insideTopRight",
              fontSize: 11,
            }}
          />
        ))}
        <Scatter
          data={data}
          fill="var(--color-value)"
          className={props.onSelect ? "cursor-pointer" : undefined}
          onClick={(entry) => {
            const { payload } = entry as unknown as { payload?: T };
            if (payload) {
              props.onSelect?.(payload);
            }
          }}
        />
      </ScatterChart>
    </ChartContainer>
  );
};

export default ReportsScatterChart;
