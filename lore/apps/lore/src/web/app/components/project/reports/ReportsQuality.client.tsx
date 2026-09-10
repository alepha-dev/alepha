import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { QualityOverview } from "@/api/schemas/qualityOverviewSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import type { I18n } from "../../../services/I18n.ts";
import ReportsKpiRow, { type ReportsKpi } from "./ReportsKpiRow.tsx";
import ReportsQualityEmpty from "./ReportsQualityEmpty.tsx";
import ReportsQualityStaleness from "./ReportsQualityStaleness.tsx";
import ReportsSection from "./ReportsSection.tsx";

export interface ReportsQualityProps {
  quality: QualityOverview;
}

/**
 * Reports "Quality" page — what CI measured about the test suite.
 *
 * Deliberately shallow for v1: four coverage percentages, the test counts, and
 * a line for each over time. No per-file view, no diff annotations, no
 * branch comparison. The raw reports are stored precisely so those stay
 * possible later without re-running CI, and adding them now would be depth
 * before anyone has looked at the shallow version.
 *
 * Labelled **Quality** rather than "Test Coverage": the payload carries test
 * counts and a duration too, so the narrow label would be wrong the day it
 * shipped.
 */
const ReportsQuality = (props: ReportsQualityProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const { latest, runs } = props.quality;

  if (!latest) {
    return <ReportsQualityEmpty projectSlug={project?.slug ?? ""} />;
  }

  const coverageChartConfig = {
    lines: { label: tr("reports.quality.lines"), color: "var(--chart-1)" },
    statements: {
      label: tr("reports.quality.statements"),
      color: "var(--chart-2)",
    },
    functions: {
      label: tr("reports.quality.functions"),
      color: "var(--chart-3)",
    },
    branches: {
      label: tr("reports.quality.branches"),
      color: "var(--chart-4)",
    },
  } satisfies ChartConfig;

  const testsChartConfig = {
    passed: { label: tr("reports.quality.passed"), color: "var(--chart-1)" },
    failed: {
      label: tr("reports.quality.failed"),
      color: "var(--destructive)",
    },
  } satisfies ChartConfig;

  const coverageKpis: ReportsKpi[] = [
    { label: tr("reports.quality.lines"), value: `${latest.coverageLines}%` },
    {
      label: tr("reports.quality.statements"),
      value: `${latest.coverageStatements}%`,
    },
    {
      label: tr("reports.quality.functions"),
      value: `${latest.coverageFunctions}%`,
    },
    {
      label: tr("reports.quality.branches"),
      value: `${latest.coverageBranches}%`,
    },
  ];

  const testKpis: ReportsKpi[] = [
    { label: tr("reports.quality.total"), value: latest.testsTotal },
    { label: tr("reports.quality.passed"), value: latest.testsPassed },
    { label: tr("reports.quality.failed"), value: latest.testsFailed },
    {
      label: tr("reports.quality.duration"),
      value: `${Math.round(latest.durationMs / 1000)}s`,
      // Two sources, one column: `numPendingTests` plus `numTodoTests`. Saying
      // so here is cheaper than a reader assuming the first.
      hint: String(
        tr("reports.quality.skipped", {
          args: [String(latest.testsSkipped)],
        }),
      ),
    },
  ];

  // The series arrives newest-first, which is right for a table and backwards
  // for a time axis.
  const series = runs.toReversed().map((run) => ({
    day: run.day,
    // Kept in the row but OFF the axis: the sha names which commit produced a
    // day's numbers, and the tooltip is where that belongs.
    commit: run.commitSha.slice(0, 7),
    lines: run.coverageLines,
    statements: run.coverageStatements,
    functions: run.coverageFunctions,
    branches: run.coverageBranches,
    passed: run.testsPassed,
    failed: run.testsFailed,
  }));

  /**
   * ⚠️ The axis is the DAY, not the commit.
   *
   * `quality_runs` stores one row per (project, branch, day) and `commitSha`
   * is explicitly not part of that key: a day can hold several pushes and
   * only the last one's sha survives. Labelling a per-day series with a
   * per-commit identifier gave "Coverage over time" an axis reading
   * `9396fcb 13de941 52ab725`, which carries no order a reader recognises
   * and no spacing anyone can judge (feedback #2094). The schema field's own
   * doc has said "the x axis of every graph on the tab" since it was
   * written; the component had drifted.
   *
   * Short on the tick, because an axis of five full dates does not fit.
   */
  const dayTick = (day: string) => String(l(day, { date: "D MMM" }));

  /**
   * The tooltip is where the sha went. It answers "which commit produced
   * this day's numbers", which is worth keeping and is not an axis label.
   *
   * ⚠️ No hour, despite the report offering "or day+hour" as an option.
   * There is at most one row per day, so an hour component would be the hour
   * of whichever push happened to land last - noise dressed as precision.
   */
  const tooltipLabel = (_value: unknown, payload: unknown) => {
    const first = (
      payload as
        | Array<{ payload?: { day: string; commit: string } }>
        | undefined
    )?.[0];
    const point = first?.payload;
    if (!point) return "";
    const date = String(l(point.day, { date: "ll" }));
    return point.commit ? `${date} · ${point.commit}` : date;
  };

  return (
    <>
      <ReportsSection
        title={tr("reports.quality.section.coverage")}
        action={<ReportsQualityStaleness latest={latest} />}
      >
        <ReportsKpiRow kpis={coverageKpis} />
      </ReportsSection>

      <ReportsSection title={tr("reports.quality.section.tests")}>
        <ReportsKpiRow kpis={testKpis} />
      </ReportsSection>

      <ReportsSection title={tr("reports.quality.section.coverageOverTime")}>
        <ChartContainer config={coverageChartConfig} className="h-64 w-full">
          <LineChart data={series}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickFormatter={dayTick}
            />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={tooltipLabel} />}
            />
            <Line dataKey="lines" stroke="var(--color-lines)" dot={false} />
            <Line
              dataKey="statements"
              stroke="var(--color-statements)"
              dot={false}
            />
            <Line
              dataKey="functions"
              stroke="var(--color-functions)"
              dot={false}
            />
            <Line
              dataKey="branches"
              stroke="var(--color-branches)"
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection title={tr("reports.quality.section.testsOverTime")}>
        <ChartContainer config={testsChartConfig} className="h-64 w-full">
          <LineChart data={series}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickFormatter={dayTick}
            />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={tooltipLabel} />}
            />
            <Line dataKey="passed" stroke="var(--color-passed)" dot={false} />
            <Line dataKey="failed" stroke="var(--color-failed)" dot={false} />
          </LineChart>
        </ChartContainer>
      </ReportsSection>
    </>
  );
};

export default ReportsQuality;
