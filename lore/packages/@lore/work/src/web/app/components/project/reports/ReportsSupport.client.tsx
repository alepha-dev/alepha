import type { ReportsSupport as ReportsSupportData } from "@lore/core/schemas";
import {
  type I18n,
  ReportsHistogram,
  ReportsKpiRow,
  ReportsSection,
  ReportsStackedArea,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface ReportsSupportProps {
  support: ReportsSupportData;
}

/**
 * Reports "Support" tab (#Q3006): feedback from intake to shipped.
 */
const ReportsSupport = (props: ReportsSupportProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { support } = props;

  const hours = (value: number) =>
    value >= 48 ? `${Math.round(value / 24)}d` : `${Math.round(value)}h`;
  const rate = (part: number, whole: number) =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-";
  const { conversion, outcomes, triage } = support;

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.support.kpi.triage"),
            definition: tr("reports.support.kpi.triage.definition"),
            value: triage.measured ? hours(triage.medianHours) : "-",
            hint: tr("reports.overview.kpi.cycleTimeHint", {
              args: [hours(triage.p85Hours)],
            }),
          },
          {
            label: tr("reports.support.kpi.accepted"),
            definition: tr("reports.support.kpi.accepted.definition"),
            value: rate(
              outcomes.accepted,
              outcomes.accepted + outcomes.rejected,
            ),
            hint: tr("reports.support.kpi.acceptedHint", {
              args: [
                String(outcomes.accepted),
                String(outcomes.rejected),
                String(outcomes.pending),
              ],
            }),
          },
          {
            label: tr("reports.support.kpi.conversion"),
            definition: tr("reports.support.kpi.conversion.definition"),
            value: rate(conversion.shipped, conversion.accepted),
            hint: tr("reports.support.kpi.conversionHint", {
              args: [String(conversion.withQuest), String(conversion.shipped)],
            }),
          },
          {
            label: tr("reports.support.kpi.resolution"),
            definition: tr("reports.support.kpi.resolution.definition"),
            value: conversion.shipped
              ? hours(conversion.medianResolutionHours)
              : "-",
            hint: tr("reports.overview.kpi.cycleTimeHint", {
              args: [hours(conversion.p85ResolutionHours)],
            }),
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.support.intake.title")}
        definition={tr("reports.support.intake.definition")}
        csv={{ filename: "feedback-intake", rows: support.intake }}
      >
        <ReportsStackedArea
          data={support.intake}
          series={[
            {
              key: "bug",
              label: tr("reports.support.type.bug"),
              color: "var(--chart-1)",
            },
            {
              key: "feature",
              label: tr("reports.support.type.feature"),
              color: "var(--chart-3)",
            },
            {
              key: "other",
              label: tr("reports.support.type.other"),
              color: "var(--chart-5)",
            },
          ]}
        />
      </ReportsSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.support.severity.title")}
          definition={tr("reports.support.severity.definition")}
          csv={{ filename: "feedback-severity", rows: support.severity }}
        >
          <ReportsHistogram
            buckets={support.severity.map((row) => ({
              label: row.value || tr("reports.support.none"),
              count: row.count,
            }))}
            countLabel={tr("reports.support.reports")}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.support.pending.title")}
          definition={tr("reports.support.pending.definition")}
          csv={{ filename: "feedback-pending", rows: support.pendingAge }}
        >
          <ReportsHistogram
            buckets={support.pendingAge.map((row) => ({
              label: tr(`reports.backlog.age.${row.key}`),
              count: row.count,
            }))}
            countLabel={tr("reports.support.reports")}
          />
        </ReportsSection>
      </div>

      <ReportsSection
        title={tr("reports.support.sources.title")}
        definition={tr("reports.support.sources.definition")}
        csv={{ filename: "feedback-sources", rows: support.sources }}
      >
        {support.sources.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            {tr("reports.support.sources.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {support.sources.map((row) => (
              <li key={row.value} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {row.value}
                </span>
                <span className="tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>
    </>
  );
};

export default ReportsSupport;
