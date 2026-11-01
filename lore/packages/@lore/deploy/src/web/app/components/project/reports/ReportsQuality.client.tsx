import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { Control } from "@alepha/ui/form";
import type { ReportsUrl } from "@lore/core/schemas";
import {
  currentProjectAtom,
  type I18n,
  ReportsKpiRow,
  type ReportsKpi,
  ReportsSection,
  ReportsUrlQuery,
} from "@lore/core/web";
import { z } from "alepha";
import { useInject, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import type { QualityReport } from "../../../../../api/schemas/qualityReportSchema.ts";
import ReportsQualityEmpty from "./ReportsQualityEmpty.tsx";
import ReportsQualityStaleness from "./ReportsQualityStaleness.tsx";

export interface ReportsQualityProps {
  quality: QualityReport;
  /**
   * The bar's page query: picking a branch keeps it.
   */
  url: ReportsUrl;
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
  const { latest, runs, previous, target, branch, branches, coverageByTag } =
    props.quality;
  const router = useRouter();
  const reportsUrl = useInject(ReportsUrlQuery);
  const branchForm = useForm({
    schema: z.object({ branch: z.text().optional() }),
    initialValues: { branch },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, value) => {
      void router.push(
        "reportsDelivery" as never,
        {
          query: reportsUrl.patch(
            props.url,
            "branch",
            value as string | undefined,
          ),
        } as never,
      );
    },
  });

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
      color: "var(--danger)",
    },
  } satisfies ChartConfig;

  const durationChartConfig = {
    seconds: {
      label: tr("reports.quality.duration"),
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig;

  const coverageDelta = (
    current: number,
    before: number | undefined,
  ): ReportsKpi["delta"] =>
    before === undefined
      ? undefined
      : {
          current,
          previous: before,
          upIsGood: true,
          format: (difference) => `${Math.round(difference * 10) / 10}%`,
        };

  const coverageKpis: ReportsKpi[] = [
    {
      label: tr("reports.quality.lines"),
      definition: tr("reports.quality.lines.definition"),
      value: `${latest.coverageLines}%`,
      delta: coverageDelta(latest.coverageLines, previous?.coverageLines),
    },
    {
      label: tr("reports.quality.statements"),
      definition: tr("reports.quality.statements.definition"),
      value: `${latest.coverageStatements}%`,
      delta: coverageDelta(
        latest.coverageStatements,
        previous?.coverageStatements,
      ),
    },
    {
      label: tr("reports.quality.functions"),
      definition: tr("reports.quality.functions.definition"),
      value: `${latest.coverageFunctions}%`,
      delta: coverageDelta(
        latest.coverageFunctions,
        previous?.coverageFunctions,
      ),
    },
    {
      label: tr("reports.quality.branches"),
      definition: tr("reports.quality.branches.definition"),
      value: `${latest.coverageBranches}%`,
      delta: coverageDelta(latest.coverageBranches, previous?.coverageBranches),
    },
  ];

  const testKpis: ReportsKpi[] = [
    {
      label: tr("reports.quality.total"),
      definition: tr("reports.quality.total.definition"),
      value: latest.testsTotal,
    },
    {
      label: tr("reports.quality.passed"),
      definition: tr("reports.quality.passed.definition"),
      value: latest.testsPassed,
    },
    {
      label: tr("reports.quality.failed"),
      definition: tr("reports.quality.failed.definition"),
      value: latest.testsFailed,
    },
    {
      label: tr("reports.quality.duration"),
      definition: tr("reports.quality.duration.definition"),
      value: `${Math.round(latest.durationMs / 1000)}s`,
      // Two sources, one column: `numPendingTests` plus `numTodoTests`. Saying
      // so here is cheaper than a reader assuming the first.
      hint: tr("reports.quality.skipped", {
        args: [String(latest.testsSkipped)],
      }),
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
    seconds: Math.round(run.durationMs / 1000),
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
  const dayTick = (day: string) => l(day, { date: "D MMM" });

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
    const date = l(point.day, { date: "ll" });
    return point.commit ? `${date} · ${point.commit}` : date;
  };

  return (
    <>
      <ReportsSection
        title={tr("reports.quality.section.coverage")}
        definition={tr("reports.quality.section.coverage.definition")}
        action={
          <div className="flex items-center gap-3">
            {branches.length > 1 ? (
              <Control
                input={branchForm.input.branch}
                label=""
                inputProps={{ "aria-label": tr("reports.quality.branch") }}
                minimal
                size="xs"
                triggerClassName="w-auto"
                items={branches.map((value) => ({ value, label: value }))}
              />
            ) : null}
            <ReportsQualityStaleness latest={latest} />
          </div>
        }
      >
        <ReportsKpiRow kpis={coverageKpis} />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.quality.section.tests")}
        definition={tr("reports.quality.section.tests.definition")}
      >
        <ReportsKpiRow kpis={testKpis} />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.quality.section.coverageOverTime")}
        definition={tr("reports.quality.section.coverageOverTime.definition")}
      >
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
            {target === undefined ? null : (
              <ReferenceLine
                y={target}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{
                  value: tr("reports.quality.target"),
                  position: "insideTopRight",
                  fontSize: 11,
                }}
              />
            )}
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

      <ReportsSection
        title={tr("reports.quality.section.testsOverTime")}
        definition={tr("reports.quality.section.testsOverTime.definition")}
      >
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

      <ReportsSection
        title={tr("reports.quality.section.duration")}
        definition={tr("reports.quality.section.duration.definition")}
      >
        <ChartContainer config={durationChartConfig} className="h-48 w-full">
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
            <Line dataKey="seconds" stroke="var(--color-seconds)" dot={false} />
          </LineChart>
        </ChartContainer>
      </ReportsSection>

      <ReportsSection
        title={tr("reports.quality.section.byTag")}
        definition={tr("reports.quality.section.byTag.definition")}
        csv={{ filename: "coverage-by-tag", rows: coverageByTag }}
      >
        {coverageByTag.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {tr("reports.quality.section.byTag.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {coverageByTag.map((row) => (
              <li key={row.tag} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {row.tag}
                </span>
                <span className="tabular-nums">{row.coverage}%</span>
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>
    </>
  );
};

export default ReportsQuality;
