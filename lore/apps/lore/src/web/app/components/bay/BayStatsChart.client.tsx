import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";

/**
 * CPU and memory over the last thirty days, one point per day.
 *
 * ⚠️ **The series is off by default.** `collectSeries` starts false, so most
 * estates have no history at all, and an empty grid would read as "this
 * machine did nothing" rather than "nobody is recording". The empty state
 * says which, and links to the switch.
 *
 * ⚠️ **History starts when the switch is flipped**, not when the machine was
 * enrolled, which the copy says so the first days are not read as an outage.
 *
 * ⚠️ **`estimated` is surfaced, not swallowed.** On Analytics Engine a window
 * is sampled and the numbers are scaled back up; a chart that hides that gets
 * trusted more than it deserves. The division by `samples` stays in
 * `EstateStatsService`, which is why that service exists.
 */
const BayStatsChart = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const estateApi = useClient<EstateController>();
  const [estate] = useStore(currentEstateAtom);

  const { data } = useQuery(
    {
      enabled: Boolean(estate),
      key: ["bay-stats", estate?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!estate) {
          return undefined;
        }
        return await estateApi.getEstateStats({
          params: { estateId: estate.id },
          query: {},
        });
      },
    },
    [estate?.id],
  );

  if (!estate) {
    return null;
  }

  const config = {
    cpuPercent: { label: tr("bay.chart.cpu"), color: "var(--chart-1)" },
    memoryPercent: { label: tr("bay.chart.memory"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const points = data?.points ?? [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr("bay.chart.title")}</h3>
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
              className="text-sm underline-offset-4 hover:underline"
              href={router.path("baySettings", {
                params: { estateId: estate.id },
              })}
            >
              {tr("bay.chart.off.link")}
            </a>
          </div>
        ) : points.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            {tr("bay.chart.empty")}
          </p>
        ) : (
          <ChartContainer config={config} className="h-56 w-full">
            <LineChart data={points}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
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
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default BayStatsChart;
