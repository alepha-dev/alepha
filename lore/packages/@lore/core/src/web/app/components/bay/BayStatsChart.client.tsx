import { Card, CardContent, cn, textLinkUnderlineClassName } from "@alepha/ui";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { HostController } from "../../../../api/controllers/HostController.ts";
import type { hostStatsRangeSchema } from "../../../../api/schemas/hostStatsRangeSchema.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface BayStatsChartProps {
  /**
   * The window drawn (#Q4528): the last hour and today (from the reader's
   * midnight) by hour, the last 7 or 30 days by day.
   */
  range: z.Infer<typeof hostStatsRangeSchema>;
}

/**
 * CPU, memory and disk over a range, at the grain the server picks for it.
 * The disk line is drawn only from the points a reading carried it
 * (#Q4420).
 *
 * ⚠️ **The series is off by default.** `collectSeries` starts false, so most
 * hosts have no history at all, and an empty grid would read as "this
 * machine did nothing" rather than "nobody is recording". The empty state
 * says which, and links to the switch.
 *
 * ⚠️ **History starts when the switch is flipped**, not when the machine was
 * enrolled, which the copy says so the first days are not read as an outage.
 *
 * ⚠️ **`estimated` is surfaced, not swallowed.** On Analytics Engine a window
 * is sampled and the numbers are scaled back up; a chart that hides that gets
 * trusted more than it deserves. The division by `samples` stays in
 * `HostStatsService`, which is why that service exists.
 */
const BayStatsChart = (props: BayStatsChartProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const router = useRouter();
  const hostApi = useClient<HostController>();
  const [host] = useStore(currentHostAtom);

  // Today starts at the reader's midnight, which only the browser knows; in
  // the key, so a page left open past midnight reads the new day.
  const since =
    props.range === "today"
      ? dateTime.now().startOf("day").toISOString()
      : undefined;

  const { data } = useQuery(
    {
      enabled: Boolean(host),
      key: ["bay-stats", host?.id, props.range, since],
      keepPreviousData: true,
      handler: async () => {
        if (!host) {
          return undefined;
        }
        return await hostApi.getHostStats({
          params: { hostId: host.id },
          query: {
            range: props.range,
            ...(since ? { since } : {}),
          },
        });
      },
    },
    [host?.id, props.range, since],
  );

  if (!host) {
    return null;
  }

  const config = {
    cpuPercent: { label: tr("bay.chart.cpu"), color: "var(--chart-1)" },
    memoryPercent: { label: tr("bay.chart.memory"), color: "var(--chart-2)" },
    diskPercent: { label: tr("bay.chart.disk"), color: "var(--chart-3)" },
  } satisfies ChartConfig;

  const points = data?.points ?? [];
  // A day reads as it is; an hour as the reader's time of day (the key is
  // UTC: `2026-11-26T14`), a minute too (a full UTC instant).
  const tick = (key: string) => {
    if (data?.grain === "hour") {
      return dateTime.of(`${key}:00:00Z`).format("HH:mm");
    }
    if (data?.grain === "minute") {
      return dateTime.of(key.endsWith("Z") ? key : `${key}Z`).format("HH:mm");
    }
    return key;
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold" data-testid="bay-stats-title">
            {tr(`bay.chart.title.${props.range}`)}
          </h3>
          {data?.estimated && (
            <span className="text-muted-foreground text-xs">
              {data.sampleInterval
                ? tr("bay.chart.estimated.interval", {
                    args: [String(data.sampleInterval)],
                  })
                : tr("bay.chart.estimated")}
            </span>
          )}
        </div>

        {!data?.collecting ? (
          <div className="flex flex-col items-start gap-2 py-6">
            <p className="text-muted-foreground text-sm">
              {tr("bay.chart.off")}
            </p>
            <a
              className={cn(
                textLinkUnderlineClassName,
                "hover:text-foreground text-sm",
              )}
              href={router.path("baySettings", {
                params: {
                  projectSlug: host.project?.slug ?? "",
                  hostSlug: host.slug,
                },
              })}
            >
              {tr("bay.chart.off.link")}
            </a>
          </div>
        ) : points.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            {tr("bay.chart.empty.range")}
          </p>
        ) : (
          <ChartContainer config={config} className="h-56 w-full">
            <LineChart data={points}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickFormatter={tick}
              />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="cpuPercent"
                stroke="var(--color-cpuPercent)"
                dot={false}
              />
              <Line
                dataKey="memoryPercent"
                stroke="var(--color-memoryPercent)"
                dot={false}
              />
              <Line
                dataKey="diskPercent"
                stroke="var(--color-diskPercent)"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default BayStatsChart;
