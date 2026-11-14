import type { ReportsKnowledge as ReportsKnowledgeData } from "@lore/core/schemas";
import {
  type I18n,
  ReportsHistogram,
  ReportsKpiRow,
  ReportsSection,
  ReportsStackedArea,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import ReportsFolioList from "./ReportsFolioList.tsx";

export interface ReportsKnowledgeProps {
  knowledge: ReportsKnowledgeData;
}

/**
 * Reports "Knowledge" tab (#Q3007): how the project's memory is kept.
 */
const ReportsKnowledge = (props: ReportsKnowledgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { knowledge } = props;
  const empty = tr("reports.knowledge.empty");
  const days = (value: number) =>
    tr("reports.backlog.days", { args: [String(Math.round(value))] });

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.knowledge.kpi.total"),
            definition: tr("reports.knowledge.kpi.total.definition"),
            value: knowledge.total,
          },
          {
            label: tr("reports.knowledge.kpi.stale"),
            definition: tr("reports.knowledge.kpi.stale.definition", {
              args: [String(knowledge.staleDays)],
            }),
            value: knowledge.staleCount,
          },
          {
            label: tr("reports.knowledge.kpi.orphans"),
            definition: tr("reports.knowledge.kpi.orphans.definition"),
            value: knowledge.orphanCount,
          },
          {
            label: tr("reports.knowledge.kpi.links"),
            definition: tr("reports.knowledge.kpi.links.definition"),
            value: knowledge.medianLinksPerFolio,
          },
          {
            label: tr("reports.knowledge.kpi.reverts"),
            definition: tr("reports.knowledge.kpi.reverts.definition"),
            value: knowledge.reverts,
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.knowledge.activity.title")}
        definition={tr("reports.knowledge.activity.definition")}
        csv={{ filename: "folio-activity", rows: knowledge.activity }}
      >
        <ReportsStackedArea
          data={knowledge.activity}
          series={[
            {
              key: "revised",
              label: tr("reports.knowledge.series.revised"),
              color: "var(--chart-3)",
            },
            {
              key: "created",
              label: tr("reports.knowledge.series.created"),
              color: "var(--chart-1)",
            },
          ]}
        />
      </ReportsSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.knowledge.mostRevised.title")}
          definition={tr("reports.knowledge.mostRevised.definition")}
          csv={{ filename: "most-revised", rows: knowledge.mostRevised }}
        >
          <ReportsFolioList
            empty={empty}
            folios={knowledge.mostRevised.map((row) => ({
              ...row,
              detail: String(row.revisions),
            }))}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.knowledge.mostLinked.title")}
          definition={tr("reports.knowledge.mostLinked.definition")}
          csv={{ filename: "most-linked", rows: knowledge.mostLinked }}
        >
          <ReportsFolioList
            empty={empty}
            folios={knowledge.mostLinked.map((row) => ({
              ...row,
              detail: String(row.links),
            }))}
          />
        </ReportsSection>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.knowledge.stale.title")}
          definition={tr("reports.knowledge.kpi.stale.definition", {
            args: [String(knowledge.staleDays)],
          })}
          csv={{ filename: "stale-folios", rows: knowledge.stale }}
        >
          <ReportsFolioList
            empty={empty}
            folios={knowledge.stale.map((row) => ({
              ...row,
              detail: [
                row.pinned ? tr("reports.knowledge.pinned") : "",
                days(row.days),
              ]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.knowledge.orphans.title")}
          definition={tr("reports.knowledge.kpi.orphans.definition")}
          csv={{ filename: "orphan-folios", rows: knowledge.orphans }}
        >
          <ReportsFolioList empty={empty} folios={knowledge.orphans} />
        </ReportsSection>
      </div>

      <ReportsSection
        title={tr("reports.knowledge.byDirectory.title")}
        definition={tr("reports.knowledge.byDirectory.definition")}
        csv={{ filename: "folios-by-directory", rows: knowledge.byDirectory }}
      >
        <ReportsHistogram
          buckets={knowledge.byDirectory.map((row) => ({
            label: row.name,
            count: row.count,
          }))}
          countLabel={tr("reports.knowledge.series.folios")}
        />
      </ReportsSection>
    </>
  );
};

export default ReportsKnowledge;
