import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { ReportsBacklog } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

export interface ReportsCompositionProps {
  rows: ReportsBacklog["byArea"];
  label?: (value: string) => string;
  onSelect?: (value: string) => void;
}

/**
 * Open work along one axis, stacked by state: every value, so its height
 * grows with them rather than folding the long tail into a top 8.
 */
const ReportsComposition = (props: ReportsCompositionProps) => {
  const { tr } = useI18n<I18n, "en">();
  const config = {
    todo: { label: tr("reports.flow.state.todo"), color: "var(--chart-3)" },
    inProgress: {
      label: tr("reports.flow.state.inProgress"),
      color: "var(--chart-4)",
    },
    onHold: { label: tr("reports.flow.state.onHold"), color: "var(--chart-5)" },
  } satisfies ChartConfig;
  const data = props.rows.map((row) => ({
    ...row,
    label: props.label?.(row.value) ?? row.value,
  }));

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: Math.max(120, data.length * 28 + 56) }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={140}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {(["todo", "inProgress", "onHold"] as const).map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="state"
            fill={`var(--color-${key})`}
            className={props.onSelect ? "cursor-pointer" : undefined}
            onClick={(_entry, index) => {
              const row = props.rows[index];
              if (row) {
                props.onSelect?.(row.value);
              }
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
};

export default ReportsComposition;
