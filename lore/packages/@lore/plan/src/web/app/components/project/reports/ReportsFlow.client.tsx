import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import type {
  ReportsFlow as ReportsFlowData,
  ReportsUrl,
} from "@lore/core/schemas";
import {
  type I18n,
  ReportsHistogram,
  ReportsKpiRow,
  ReportsScatterChart,
  ReportsSection,
  ReportsStackedArea,
  useReportsDrillDown,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportsFlowProps {
  flow: ReportsFlowData;
  url: ReportsUrl;
}

/**
 * Reports "Flow" tab (#Q3000): how work moved through the period.
 */
const ReportsFlow = (props: ReportsFlowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const drillDown = useReportsDrillDown(props.url);
  const { flow } = props;

  const duration = (hours: number) =>
    hours >= 48 ? `${Math.round(hours / 24)}d` : `${Math.round(hours)}h`;
  const net = flow.throughput.reduce((sum, point) => sum + point.net, 0);
  const isEmpty = flow.scatter.length === 0 && flow.period.created === 0;
  const empty = (
    <p className="text-muted-foreground py-6 text-center text-sm">
      {tr("reports.flow.empty")}
    </p>
  );
  const bucket = (key: string) => tr(`reports.flow.bucket.${key}`);
  const openQuest = (shortId: number) =>
    router.push("projectQuest", {
      params: {
        projectSlug: router.state.params.projectSlug,
        shortId: String(shortId),
      },
    });

  const throughputConfig = {
    completed: {
      label: tr("reports.flow.series.completed"),
      color: "var(--chart-1)",
    },
    created: {
      label: tr("reports.flow.series.created"),
      color: "var(--chart-3)",
    },
    rollingMedian: {
      label: tr("reports.flow.series.rollingMedian"),
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;
  const wipConfig = {
    inProgress: {
      label: tr("reports.flow.state.inProgress"),
      color: "var(--chart-4)",
    },
  } satisfies ChartConfig;

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.flow.kpi.throughput"),
            definition: tr("reports.flow.kpi.throughput.definition"),
            value: flow.period.completed,
            delta: flow.previous && {
              current: flow.period.completed,
              previous: flow.previous.completed,
              upIsGood: true,
            },
          },
          {
            label: tr("reports.flow.kpi.cycle"),
            definition: tr("reports.flow.kpi.cycle.definition"),
            value: duration(flow.cycleP50Hours),
            hint: tr("reports.overview.kpi.cycleTimeHint", {
              args: [duration(flow.cycleP85Hours)],
            }),
            delta: flow.previous && {
              current: flow.period.medianCycleTimeHours,
              previous: flow.previous.medianCycleTimeHours,
              upIsGood: false,
              format: duration,
            },
          },
          {
            label: tr("reports.flow.kpi.lead"),
            definition: tr("reports.flow.kpi.lead.definition"),
            value: duration(flow.leadP50Hours),
            hint: tr("reports.overview.kpi.cycleTimeHint", {
              args: [duration(flow.leadP85Hours)],
            }),
          },
          {
            label: tr("reports.flow.kpi.wip"),
            definition: tr("reports.flow.kpi.wip.definition"),
            value: flow.wip,
          },
          {
            label: tr("reports.flow.kpi.net"),
            definition: tr("reports.flow.kpi.net.definition"),
            value: `${net > 0 ? "+" : ""}${net}`,
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.flow.throughput.title")}
        definition={tr("reports.flow.throughput.definition")}
        csv={{ filename: "throughput", rows: flow.throughput }}
      >
        {isEmpty ? (
          empty
        ) : (
          <ChartContainer
            config={throughputConfig}
            className="aspect-auto h-[260px] w-full"
          >
            <ComposedChart data={flow.throughput}>
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
                dataKey="completed"
                fill="var(--color-completed)"
                radius={[4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={() => drillDown({ status: "completed" })}
              />
              <Bar
                dataKey="created"
                fill="var(--color-created)"
                radius={[4, 4, 0, 0]}
              />
              <Line
                dataKey="rollingMedian"
                stroke="var(--color-rollingMedian)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.cumulative.title")}
        definition={tr("reports.flow.cumulative.definition")}
        csv={{ filename: "cumulative-flow", rows: flow.cumulative }}
      >
        <ReportsStackedArea
          data={flow.cumulative}
          series={[
            {
              key: "done",
              label: tr("reports.flow.state.done"),
              color: "var(--chart-1)",
            },
            {
              key: "onHold",
              label: tr("reports.flow.state.onHold"),
              color: "var(--chart-5)",
            },
            {
              key: "inProgress",
              label: tr("reports.flow.state.inProgress"),
              color: "var(--chart-4)",
            },
            {
              key: "todo",
              label: tr("reports.flow.state.todo"),
              color: "var(--chart-3)",
            },
          ]}
          onSelect={(key) =>
            drillDown({
              status: {
                done: "completed",
                onHold: "on_hold",
                inProgress: "in_progress",
                todo: "todo",
              }[key],
            })
          }
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.wip.title")}
        definition={tr("reports.flow.wip.definition")}
      >
        <ChartContainer
          config={wipConfig}
          className="aspect-auto h-[200px] w-full"
        >
          <LineChart data={flow.cumulative}>
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
            <Line
              dataKey="inProgress"
              stroke="var(--color-inProgress)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.scatter.title")}
        definition={tr("reports.flow.scatter.definition")}
        csv={{ filename: "cycle-time", rows: flow.scatter }}
      >
        {flow.scatter.length === 0 ? (
          empty
        ) : (
          <ReportsScatterChart
            points={flow.scatter.map((row) => ({
              shortId: row.shortId,
              date: row.date,
              value: row.hours,
              label: `#${row.shortId} ${row.title}`,
            }))}
            valueLabel={tr("reports.flow.series.hours")}
            lines={[
              { label: "p50", value: flow.cycleP50Hours },
              { label: "p85", value: flow.cycleP85Hours },
            ]}
            onSelect={(point) => openQuest(point.shortId)}
          />
        )}
      </ReportsSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.flow.cycleHistogram.title")}
          definition={tr("reports.flow.cycleHistogram.definition")}
          csv={{ filename: "cycle-histogram", rows: flow.cycleHistogram }}
        >
          <ReportsHistogram
            buckets={flow.cycleHistogram.map((row) => ({
              label: bucket(row.key),
              count: row.count,
            }))}
            countLabel={tr("reports.flow.series.quests")}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.flow.leadHistogram.title")}
          definition={tr("reports.flow.leadHistogram.definition")}
          csv={{ filename: "lead-histogram", rows: flow.leadHistogram }}
        >
          <ReportsHistogram
            buckets={flow.leadHistogram.map((row) => ({
              label: bucket(row.key),
              count: row.count,
            }))}
            countLabel={tr("reports.flow.series.quests")}
          />
        </ReportsSection>
      </div>

      <ReportsSection
        title={tr("reports.flow.aging.title")}
        definition={tr("reports.flow.aging.definition")}
        csv={{ filename: "aging-wip", rows: flow.aging }}
      >
        {flow.aging.length === 0 ? (
          empty
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {flow.aging.map((quest) => (
              <li key={quest.shortId} className="flex items-center gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => openQuest(quest.shortId)}
                >
                  #{quest.shortId} {quest.title}
                </button>
                <span className="text-muted-foreground text-xs">
                  {tr(`reports.flow.band.${quest.band}`)}
                </span>
                <span className="w-12 text-right tabular-nums">
                  {Math.round(quest.ageDays)}d
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.time.title")}
        definition={tr("reports.flow.time.definition")}
        csv={{ filename: "board-columns", rows: flow.columns }}
      >
        <ReportsKpiRow
          kpis={[
            {
              label: tr("reports.flow.time.hold"),
              definition: tr("reports.flow.time.hold.definition"),
              value: duration(flow.hold.medianHours),
              hint: tr("reports.flow.time.holdHint", {
                args: [String(flow.hold.quests), duration(flow.hold.p85Hours)],
              }),
            },
            ...flow.columns.map((column) => ({
              label: column.column,
              definition: tr("reports.flow.time.column.definition"),
              value: duration(column.medianHours),
              hint: tr("reports.overview.kpi.cycleTimeHint", {
                args: [duration(column.p85Hours)],
              }),
            })),
          ]}
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.sizes.title")}
        definition={tr("reports.flow.sizes.definition")}
        csv={{ filename: "cycle-by-size", rows: flow.sizes }}
      >
        {flow.sizes.length === 0 ? (
          empty
        ) : (
          <ReportsKpiRow
            kpis={flow.sizes.map((row) => ({
              label: tr(`reports.flow.size.${row.size}`),
              definition: tr("reports.flow.size.definition"),
              value: duration(row.medianHours),
              hint: tr("reports.flow.size.hint", {
                args: [String(row.quests), duration(row.p85Hours)],
              }),
            }))}
          />
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.estimates.title")}
        definition={tr("reports.flow.estimates.definition")}
        csv={{ filename: "estimates", rows: flow.estimates }}
      >
        {flow.estimates.length === 0 ? (
          empty
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {flow.estimates.map((row) => (
              <li key={row.shortId} className="flex items-center gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => openQuest(row.shortId)}
                >
                  #{row.shortId} {row.title}
                </button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {tr(
                    row.tracked
                      ? "reports.flow.estimates.tracked"
                      : "reports.flow.estimates.cycle",
                    {
                      args: [
                        duration(row.estimateHours),
                        duration(row.actualHours),
                      ],
                    },
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.flow.due.title")}
        definition={tr("reports.flow.due.definition")}
      >
        {flow.dueDates.withDue === 0 ? (
          empty
        ) : (
          <ReportsKpiRow
            kpis={[
              {
                label: tr("reports.flow.due.rate"),
                definition: tr("reports.flow.due.definition"),
                value: `${Math.round(
                  (flow.dueDates.onTime / flow.dueDates.withDue) * 100,
                )}%`,
                hint: tr("reports.flow.due.hint", {
                  args: [
                    String(flow.dueDates.onTime),
                    String(flow.dueDates.withDue),
                  ],
                }),
              },
            ]}
          />
        )}
      </ReportsSection>
    </>
  );
};

export default ReportsFlow;
