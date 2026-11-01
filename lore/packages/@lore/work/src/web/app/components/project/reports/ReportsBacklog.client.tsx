import type {
  ReportsBacklog as ReportsBacklogData,
  ReportsUrl,
} from "@lore/core/schemas";
import {
  type I18n,
  ReportsHistogram,
  ReportsKpiRow,
  ReportsQuestList,
  ReportsSection,
  useProjectUsers,
  useReportsDrillDown,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import ReportsComposition from "./ReportsComposition.client.tsx";

export interface ReportsBacklogProps {
  backlog: ReportsBacklogData;
  url: ReportsUrl;
}

/**
 * Reports "Backlog" tab (#Q3002): the open work as it stands.
 */
const ReportsBacklog = (props: ReportsBacklogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const drillDown = useReportsDrillDown(props.url);
  const users = useProjectUsers();
  const { backlog } = props;

  const nameOf = (id?: string) => {
    const user = users.find((it) => it.id === id);
    return user?.username ?? user?.email ?? "";
  };
  const daysLabel = (days: number) =>
    tr("reports.backlog.days", { args: [String(Math.round(days))] });
  const empty = tr("reports.backlog.empty");
  const decided = backlog.objectives.completed + backlog.objectives.waived;

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.backlog.kpi.open"),
            definition: tr("reports.backlog.kpi.open.definition"),
            value: backlog.open,
          },
          {
            label: tr("reports.backlog.kpi.overdue"),
            definition: tr("reports.backlog.kpi.overdue.definition"),
            value: backlog.overdue.length,
          },
          {
            label: tr("reports.backlog.kpi.shelved"),
            definition: tr("reports.backlog.kpi.shelved.definition"),
            value: `${Math.round(backlog.shelvedRate)}%`,
          },
          {
            label: tr("reports.backlog.kpi.waived"),
            definition: tr("reports.backlog.kpi.waived.definition"),
            value: decided
              ? `${Math.round((backlog.objectives.waived / decided) * 100)}%`
              : "-",
            hint: tr("reports.backlog.kpi.waivedHint", {
              args: [
                String(backlog.objectives.completed),
                String(backlog.objectives.waived),
              ],
            }),
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.backlog.byArea.title")}
        definition={tr("reports.backlog.byArea.definition")}
        csv={{ filename: "backlog-by-area", rows: backlog.byArea }}
      >
        <ReportsComposition
          rows={backlog.byArea}
          onSelect={(area) => drillDown({ area })}
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.backlog.byTag.title")}
        definition={tr("reports.backlog.byTag.definition")}
        csv={{ filename: "backlog-by-tag", rows: backlog.byTag }}
      >
        <ReportsComposition
          rows={backlog.byTag}
          onSelect={(tag) => drillDown({ tag })}
        />
      </ReportsSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.backlog.byPriority.title")}
          definition={tr("reports.backlog.byPriority.definition")}
          csv={{ filename: "backlog-by-priority", rows: backlog.byPriority }}
        >
          <ReportsComposition
            rows={backlog.byPriority}
            label={(value) => tr(`dashboard.filterValue.${value}` as never)}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.backlog.bySize.title")}
          definition={tr("reports.backlog.bySize.definition")}
          csv={{ filename: "backlog-by-size", rows: backlog.bySize }}
        >
          <ReportsComposition
            rows={backlog.bySize}
            label={(value) => tr(`reports.flow.size.${value}` as never)}
          />
        </ReportsSection>
      </div>

      <ReportsSection
        title={tr("reports.backlog.age.title")}
        definition={tr("reports.backlog.age.definition")}
        csv={{ filename: "backlog-age", rows: backlog.age }}
      >
        <ReportsHistogram
          buckets={backlog.age.map((row) => ({
            label: tr(`reports.backlog.age.${row.key}` as never),
            count: row.count,
          }))}
          countLabel={tr("reports.flow.series.quests")}
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.backlog.blocked.title")}
        definition={tr("reports.backlog.blocked.definition")}
      >
        <ReportsQuestList
          empty={empty}
          quests={backlog.blocked.map((chain) => ({
            ...chain.blocker,
            detail: tr("reports.backlog.blocked.detail", {
              args: [String(chain.blocked.length), String(chain.depth)],
            }),
          }))}
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.backlog.held.title")}
        definition={tr("reports.backlog.held.definition")}
        csv={{ filename: "held", rows: backlog.held }}
      >
        <ReportsQuestList
          empty={empty}
          quests={backlog.held.map((quest) => ({
            shortId: quest.shortId,
            title: quest.title,
            detail: [nameOf(quest.heldBy), daysLabel(quest.heldDays)]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
      </ReportsSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <ReportsSection
          title={tr("reports.backlog.overdue.title")}
          definition={tr("reports.backlog.overdue.definition")}
          csv={{ filename: "overdue", rows: backlog.overdue }}
        >
          <ReportsQuestList
            empty={empty}
            quests={backlog.overdue.map((quest) => ({
              ...quest,
              detail: daysLabel(quest.days),
            }))}
          />
        </ReportsSection>
        <ReportsSection
          title={tr("reports.backlog.dueSoon.title")}
          definition={tr("reports.backlog.dueSoon.definition")}
          csv={{ filename: "due-soon", rows: backlog.dueSoon }}
        >
          <ReportsQuestList
            empty={empty}
            quests={backlog.dueSoon.map((quest) => ({
              ...quest,
              detail: daysLabel(quest.days),
            }))}
          />
        </ReportsSection>
      </div>

      <ReportsSection
        title={tr("reports.backlog.hygiene.title")}
        definition={tr("reports.backlog.hygiene.definition")}
        csv={{ filename: "hygiene", rows: backlog.hygiene }}
      >
        <ReportsQuestList
          empty={empty}
          quests={backlog.hygiene.map((quest) => ({
            shortId: quest.shortId,
            title: quest.title,
            detail: [
              quest.noObjectives
                ? tr("reports.backlog.hygiene.noObjectives")
                : "",
              quest.noDescription
                ? tr("reports.backlog.hygiene.noDescription")
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
      </ReportsSection>
    </>
  );
};

export default ReportsBacklog;
