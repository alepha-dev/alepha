import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { ReportsDelivery as ReportsDeliveryData } from "@lore/core/schemas";
import { type I18n, ReportsKpiRow, ReportsSection } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportsDeliveryProps {
  delivery: ReportsDeliveryData;
}

/**
 * Reports "Delivery" tab (#Q3008): DORA's four keys, then what ran.
 */
const ReportsDelivery = (props: ReportsDeliveryProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { delivery } = props;

  const hours = (value: number) =>
    value >= 48 ? `${Math.round(value / 24)}d` : `${Math.round(value)}h`;
  const minutes = (value: number) =>
    value >= 120 ? `${Math.round(value / 60)}h` : `${Math.round(value)}m`;

  const deployConfig = {
    succeeded: {
      label: tr("reports.delivery.series.succeeded"),
      color: "var(--chart-1)",
    },
    failed: {
      label: tr("reports.delivery.series.failed"),
      color: "var(--danger)",
    },
  } satisfies ChartConfig;
  const durationConfig = {
    medianDurationMinutes: {
      label: tr("reports.delivery.series.duration"),
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.delivery.kpi.frequency"),
            definition: tr("reports.delivery.kpi.frequency.definition"),
            value: Math.round(delivery.deploysPerWeek * 10) / 10,
          },
          {
            label: tr("reports.delivery.kpi.lead"),
            definition: tr("reports.delivery.kpi.lead.definition"),
            value: delivery.lead.measured
              ? hours(delivery.lead.medianHours)
              : "-",
            hint: tr("reports.delivery.kpi.leadHint", {
              args: [
                hours(delivery.lead.p85Hours),
                String(delivery.lead.unmatched),
              ],
            }),
          },
          {
            label: tr("reports.delivery.kpi.failure"),
            definition: tr("reports.delivery.kpi.failure.definition"),
            value: `${Math.round(delivery.changeFailureRate)}%`,
            hint: tr("reports.delivery.kpi.failureHint", {
              args: [String(delivery.failed), String(delivery.rollbacks)],
            }),
          },
          {
            label: tr("reports.delivery.kpi.restore"),
            definition: tr("reports.delivery.kpi.restore.definition"),
            value: delivery.restore.incidents
              ? minutes(delivery.restore.medianMinutes)
              : "-",
            hint: tr("reports.delivery.kpi.restoreHint", {
              args: [
                minutes(delivery.restore.p85Minutes),
                String(delivery.restore.incidents),
              ],
            }),
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.delivery.deploys.title")}
        definition={tr("reports.delivery.deploys.definition")}
        csv={{ filename: "deploys", rows: delivery.timeline }}
      >
        <ChartContainer
          config={deployConfig}
          className="aspect-auto h-[220px] w-full"
        >
          <BarChart data={delivery.timeline}>
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
            <Bar
              dataKey="succeeded"
              stackId="run"
              fill="var(--color-succeeded)"
            />
            <Bar dataKey="failed" stackId="run" fill="var(--color-failed)" />
          </BarChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection
        title={tr("reports.delivery.duration.title")}
        definition={tr("reports.delivery.duration.definition")}
      >
        <ChartContainer
          config={durationConfig}
          className="aspect-auto h-[180px] w-full"
        >
          <LineChart data={delivery.timeline}>
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
              dataKey="medianDurationMinutes"
              stroke="var(--color-medianDurationMinutes)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection
        title={tr("reports.delivery.apps.title")}
        definition={tr("reports.delivery.apps.definition")}
        csv={{ filename: "deploys-by-app", rows: delivery.apps }}
      >
        {delivery.apps.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {tr("reports.delivery.apps.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.delivery.apps.app")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.delivery.series.succeeded")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.delivery.series.failed")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.delivery.apps.rollbacks")}
                  </th>
                  <th className="py-1 font-medium">
                    {tr("reports.delivery.series.duration")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {delivery.apps.map((row) => (
                  <tr
                    key={`${row.app}/${row.env}`}
                    className="border-border border-t"
                  >
                    <td className="py-1 pr-3">
                      {row.app}/{row.env}
                    </td>
                    <td className="py-1 pr-3">{row.succeeded}</td>
                    <td className="py-1 pr-3">{row.failed}</td>
                    <td className="py-1 pr-3">{row.rollbacks}</td>
                    <td className="py-1">
                      {minutes(row.medianDurationMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportsSection>
    </>
  );
};

export default ReportsDelivery;
