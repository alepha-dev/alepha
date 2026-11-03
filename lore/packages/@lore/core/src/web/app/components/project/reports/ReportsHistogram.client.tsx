import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

export interface ReportsHistogramBucket {
  label: string;
  count: number;
}

export interface ReportsHistogramProps {
  buckets: ReportsHistogramBucket[];
  countLabel: string;
  onSelect?: (bucket: ReportsHistogramBucket) => void;
}

/**
 * A distribution, one bar per bucket (#Q2997). The buckets are the server's, so
 * a chart and its CSV cannot disagree on the edges.
 */
const ReportsHistogram = (props: ReportsHistogramProps) => {
  const config = {
    count: { label: props.countLabel, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
      <BarChart data={props.buckets}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
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
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
          className={props.onSelect ? "cursor-pointer" : undefined}
          onClick={(_entry, index) => {
            const bucket = props.buckets[index];
            if (bucket) {
              props.onSelect?.(bucket);
            }
          }}
        />
      </BarChart>
    </ChartContainer>
  );
};

export default ReportsHistogram;
