import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { ReportsDelivery } from "@lore/core/schemas";
import { type I18n, ReportsKpiRow, ReportsSection } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportsReliabilityProps {
  reliability: ReportsDelivery["reliability"];
}

/**
 * The Delivery tab's reliability sections (#Q3009).
 *
 * ⚠️ A blight's `name` is attacker-controlled: it is rendered as text here, and
 * must never reach a markdown or HTML renderer.
 */
const ReportsReliability = (props: ReportsReliabilityProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { reliability } = props;

  const hours = (value: number) =>
    value >= 48 ? `${Math.round(value / 24)}d` : `${Math.round(value)}h`;
  const minutes = (value: number) =>
    value >= 120 ? `${Math.round(value / 60)}h` : `${Math.round(value)}m`;

  const blightConfig = {
    opened: {
      label: tr("reports.reliability.series.opened"),
      color: "var(--chart-3)",
    },
    resolved: {
      label: tr("reports.reliability.series.resolved"),
      color: "var(--chart-1)",
    },
    open: {
      label: tr("reports.reliability.series.open"),
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;
  const errorConfig = {
    count: {
      label: tr("reports.reliability.series.occurrences"),
      color: "var(--danger)",
    },
  } satisfies ChartConfig;

  return (
    <>
      <ReportsSection
        title={tr("reports.reliability.errors.title")}
        definition={tr("reports.reliability.errors.definition")}
        csv={{ filename: "blights", rows: reliability.projectErrors }}
      >
        <ChartContainer
          config={blightConfig}
          className="aspect-auto h-[220px] w-full"
        >
          <ComposedChart data={reliability.projectErrors}>
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
            <Bar dataKey="opened" fill="var(--color-opened)" radius={2} />
            <Bar dataKey="resolved" fill="var(--color-resolved)" radius={2} />
            <Line
              dataKey="open"
              stroke="var(--color-open)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
        <ReportsKpiRow
          kpis={[
            {
              label: tr("reports.reliability.forwarded"),
              definition: tr("reports.reliability.forwarded.definition"),
              value: reliability.forwarded.total,
              hint: tr("reports.reliability.forwarded.hint", {
                args: [String(reliability.forwarded.fixed)],
              }),
            },
            {
              label: tr("reports.reliability.fix"),
              definition: tr("reports.reliability.fix.definition"),
              value: reliability.forwarded.fixed
                ? hours(reliability.forwarded.medianFixHours)
                : "-",
              hint: tr("reports.reliability.fix.hint", {
                args: [hours(reliability.forwarded.p85FixHours)],
              }),
            },
          ]}
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.reliability.top.title")}
        definition={tr("reports.reliability.top.definition")}
        csv={{ filename: "top-blights", rows: reliability.topErrors }}
      >
        {reliability.topErrors.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {tr("reports.reliability.top.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {reliability.topErrors.map((row) => (
              <li
                key={`${row.name}/${row.count}`}
                className="flex items-center gap-3"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {row.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {row.origin} · {row.status}
                </span>
                <span className="w-12 text-right tabular-nums">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.reliability.occurrences.title")}
        definition={tr("reports.reliability.occurrences.definition")}
        csv={{ filename: "errors", rows: reliability.errors }}
      >
        <ChartContainer
          config={errorConfig}
          className="aspect-auto h-[200px] w-full"
        >
          <LineChart data={reliability.errors}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {reliability.deployMarkers.map((date) => (
              <ReferenceLine
                key={date}
                x={date}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
              />
            ))}
            <Line
              dataKey="count"
              stroke="var(--color-count)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection
        title={tr("reports.reliability.uptime.title")}
        definition={tr("reports.reliability.uptime.definition")}
        csv={{ filename: "uptime", rows: reliability.monitors }}
      >
        {reliability.monitors.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {tr("reports.reliability.uptime.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.reliability.uptime.monitor")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.reliability.uptime.uptime")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.reliability.uptime.incidents")}
                  </th>
                  <th className="py-1 font-medium">
                    {tr("reports.reliability.uptime.mttr")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {reliability.monitors.map((row) => (
                  <tr key={row.name} className="border-border border-t">
                    <td className="py-1 pr-3">{row.name}</td>
                    <td className="py-1 pr-3">
                      {row.uptime === undefined
                        ? "-"
                        : `${Math.round(row.uptime * 100) / 100}%`}
                    </td>
                    <td className="py-1 pr-3">{row.incidents}</td>
                    <td className="py-1">
                      {row.incidents ? minutes(row.mttrMinutes) : "-"}
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

export default ReportsReliability;
