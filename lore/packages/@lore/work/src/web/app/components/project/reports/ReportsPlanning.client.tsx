import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type { ReportsPlanning as ReportsPlanningData } from "@lore/core/schemas";
import { type I18n, ReportsSection } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import ReportsEpicTimeline from "./ReportsEpicTimeline.tsx";

export interface ReportsPlanningProps {
  planning: ReportsPlanningData;
}

/**
 * Reports "Planning" tab (#Q3003): the project's epics.
 */
const ReportsPlanning = (props: ReportsPlanningProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { planning } = props;

  const config = {
    scope: { label: tr("reports.planning.scope"), color: "var(--chart-3)" },
    done: { label: tr("reports.planning.done"), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const hours = (value: number) =>
    value >= 48 ? `${Math.round(value / 24)}d` : `${Math.round(value)}h`;
  const empty = (
    <p className="text-muted-foreground py-6 text-center text-sm">
      {tr("reports.planning.empty")}
    </p>
  );

  return (
    <>
      <ReportsSection
        title={tr("reports.planning.timeline.title")}
        definition={tr("reports.planning.timeline.definition")}
      >
        {planning.epics.length === 0 ? (
          empty
        ) : (
          <ReportsEpicTimeline epics={planning.epics} />
        )}
      </ReportsSection>

      <ReportsSection
        title={
          planning.burnup
            ? tr("reports.planning.burnup.titleOf", {
                args: [planning.burnup.title],
              })
            : tr("reports.planning.burnup.title")
        }
        definition={tr("reports.planning.burnup.definition")}
        csv={
          planning.burnup && {
            filename: "epic-burnup",
            rows: planning.burnup.points,
          }
        }
      >
        {planning.burnup ? (
          <ChartContainer
            config={config}
            className="aspect-auto h-[260px] w-full"
          >
            <LineChart data={planning.burnup.points}>
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
        ) : (
          empty
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.planning.table.title")}
        definition={tr("reports.planning.table.definition")}
        csv={{ filename: "epics", rows: planning.epics }}
      >
        {planning.epics.length === 0 ? (
          empty
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.planning.table.epic")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.planning.table.done")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.planning.table.cycle")}
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    {tr("reports.planning.table.days")}
                  </th>
                  <th className="py-1 font-medium">
                    {tr("reports.planning.table.scope")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {planning.epics.map((epic) => (
                  <tr key={epic.id} className="border-border border-t">
                    <td className="max-w-xs truncate py-1 pr-3">
                      {epic.title}
                    </td>
                    <td className="py-1 pr-3">
                      {epic.done}/{epic.total}
                    </td>
                    <td className="py-1 pr-3">
                      {hours(epic.medianCycleHours)}
                    </td>
                    <td className="py-1 pr-3">
                      {Math.round(epic.daysInProgress)}
                    </td>
                    <td className="py-1">{Math.round(epic.scopeChange)}%</td>
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

export default ReportsPlanning;
