import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { AdminMcpController } from "@/api/controllers/AdminMcpController.ts";

export interface AdminMcpCallsChartProps {
  /**
   * What `readMcpCalls` answered, or `undefined` while it has not.
   */
  data: Awaited<ReturnType<AdminMcpController["readMcpCalls"]>> | undefined;
  loading: boolean;
}

/**
 * The thirty-day timeline of `/admin/mcp`, drawn as the top addon of the
 * per-tool table, the way `AdminFilesUsage` sits above the rows of
 * `/admin/files` (#Q2498).
 *
 * The timeline says how much; the table under it says how those calls ended.
 *
 * ⚠️ `estimated` is surfaced here, unlike Home's fourteen bars: this page is
 * read by somebody deciding whether a refusal rate is real, and a sampled
 * number they cannot tell from an exact one is worse than no number at all.
 *
 * Literal English, like every other page in the Lore admin: this shell is
 * untranslated. A `.client` file, because recharts must stay out of the
 * Worker bundle.
 */
export const AdminMcpCallsChart = (props: AdminMcpCallsChartProps) => {
  const { data, loading } = props;
  const days = data?.days ?? [];
  const tools = data?.tools ?? [];
  const total = (data?.leaderboard ?? []).reduce(
    (sum, row) => sum + row.total,
    0,
  );

  /**
   * One series per busy tool, each its own colour from the theme's chart
   * ramp. Eight is what the endpoint sends and what `--chart-1..8` offers, so
   * the two agree by construction rather than by a modulo nobody would notice
   * going wrong.
   */
  const config = Object.fromEntries(
    tools.map((series, index) => [
      series.tool,
      { label: series.tool, color: `var(--chart-${index + 1})` },
    ]),
  ) satisfies ChartConfig;

  /**
   * Recharts wants one object per x value with a key per series, and the
   * endpoint sends one series per tool. Transposed here rather than on the
   * server, because the wire shape is the one a table and a chart both read.
   */
  const points = days.map((day, index) => ({
    day,
    ...Object.fromEntries(
      tools.map((series) => [series.tool, series.counts[index] ?? 0]),
    ),
  }));

  return (
    <div className="bg-background flex flex-col gap-3 rounded-md border px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-muted-foreground text-sm">
          calls over {days.length} days
        </span>
        {data?.estimated && (
          <span className="text-muted-foreground ml-auto text-xs">
            {data.sampleInterval && data.sampleInterval > 1
              ? `Estimated from a 1-in-${data.sampleInterval} sample`
              : "Exact (no sampling at this volume)"}
          </span>
        )}
      </div>

      {tools.length > 0 ? (
        <ChartContainer
          config={config}
          className="aspect-auto h-[220px] w-full"
        >
          <BarChart data={points}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {tools.map((series) => (
              <Bar
                key={series.tool}
                dataKey={series.tool}
                stackId="calls"
                fill={`var(--color-${series.tool})`}
              />
            ))}
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {loading
            ? "Reading…"
            : "No tool call has been recorded yet. Recording started with the deploy that added this page, so the window fills in from there."}
        </p>
      )}
    </div>
  );
};
