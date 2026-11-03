import { Button, UserAvatar } from "@alepha/ui";
import type { ReportsTeam as ReportsTeamData } from "@lore/core/schemas";
import {
  type I18n,
  ReportsHeatmap,
  ReportsHistogram,
  ReportsKpiRow,
  ReportsSection,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import ReportsTeamExplorer from "./ReportsTeamExplorer.tsx";

export interface ReportsTeamProps {
  team: ReportsTeamData;
}

/**
 * Reports "Team" tab (#Q3013): balance, not output. There is no rank column
 * and no sort by anything a member produced, on purpose.
 */
const ReportsTeam = (props: ReportsTeamProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { team } = props;
  const [sort, setSort] = useState<"name" | "wip">("name");

  const total = (
    read: (member: ReportsTeamData["members"][number]) => number,
  ) => team.members.reduce((sum, member) => sum + read(member), 0);
  const share = (part: number, whole: number) =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-";

  const known = team.channels
    .filter((row) => row.channel !== "unknown")
    .reduce((sum, row) => sum + row.count, 0);
  const { automations } = team;
  const hours = Array.from({ length: 24 }, (_, hour) => String(hour));
  const agents = team.channels.find((row) => row.channel === "mcp")?.count ?? 0;

  // The server answers by name, so that order needs no sort of its own.
  const members =
    sort === "name"
      ? team.members
      : team.members.toSorted(
          (a, b) => b.wip - a.wip || a.name.localeCompare(b.name),
        );

  const columns = [
    ["wip", (m) => m.wip],
    ["held", (m) => m.held],
    ["overdue", (m) => m.overdue],
    ["created", (m) => m.questsCreated],
    ["completed", (m) => m.questsCompleted],
    ["comments", (m) => m.comments],
    ["folios", (m) => m.folioRevisions],
    ["triaged", (m) => m.feedbackTriaged],
    ["deploys", (m) => m.deploys],
    ["agents", (m) => share(m.agentWrites, m.writes)],
  ] as const satisfies ReadonlyArray<
    readonly [
      string,
      (member: ReportsTeamData["members"][number]) => number | string,
    ]
  >;

  return (
    <>
      <ReportsKpiRow
        kpis={[
          {
            label: tr("reports.team.kpi.wip"),
            definition: tr("reports.team.kpi.wip.definition"),
            value: total((member) => member.wip),
          },
          {
            label: tr("reports.team.kpi.held"),
            definition: tr("reports.team.kpi.held.definition"),
            value: total((member) => member.held),
          },
          {
            label: tr("reports.team.kpi.overdue"),
            definition: tr("reports.team.kpi.overdue.definition"),
            value: total((member) => member.overdue),
          },
          {
            label: tr("reports.team.kpi.agents"),
            definition: tr("reports.team.kpi.agents.definition"),
            value: share(agents, known),
          },
        ]}
      />

      <ReportsSection
        title={tr("reports.team.members.title")}
        definition={tr("reports.team.members.definition")}
        csv={{ filename: "team", rows: team.members }}
        action={
          <div className="flex gap-1" data-testid="reports-team-sort">
            {(["name", "wip"] as const).map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={sort === key ? "outlined" : "minimal"}
                onClick={() => setSort(key)}
              >
                {tr(`reports.team.sort.${key}`)}
              </Button>
            ))}
          </div>
        }
      >
        {members.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="reports-team">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium">
                    {tr("reports.team.column.member")}
                  </th>
                  {columns.map(([key]) => (
                    <th
                      key={key}
                      className="py-2 pr-4 text-right font-medium whitespace-nowrap"
                    >
                      {tr(`reports.team.column.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {members.map((member) => (
                  <tr key={member.userId}>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          public
                          fileId={member.picture}
                          className="size-6"
                          alt={member.name}
                        />
                        <span className="truncate">{member.name}</span>
                      </span>
                    </td>
                    {columns.map(([key, read]) => (
                      <td
                        key={key}
                        className="py-2 pr-4 text-right tabular-nums"
                      >
                        {read(member)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("reports.team.members.empty")}
          </p>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.team.channels.title")}
        definition={tr("reports.team.channels.definition")}
        csv={{ filename: "team-channels", rows: team.channels }}
      >
        <ReportsHistogram
          buckets={team.channels.map((row) => ({
            label: tr(`reports.team.channel.${row.channel}`),
            count: row.count,
          }))}
          countLabel={tr("reports.team.channels.writes")}
        />
        {team.estimated && (
          <p className="text-muted-foreground mt-2 text-xs">
            {tr("reports.team.estimated")}
          </p>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.team.heatmap.title")}
        definition={tr("reports.team.heatmap.definition")}
      >
        <ReportsHeatmap
          columns={hours}
          rows={team.heatmap.map((cells, day) => ({
            label: tr(`reports.team.day.${day}`),
            cells,
          }))}
          describe={(day, hour, value) =>
            tr("reports.team.heatmap.cell", {
              args: [day, hour, String(value)],
            })
          }
        />
      </ReportsSection>

      <ReportsSection
        title={tr("reports.team.automations.title")}
        definition={tr("reports.team.automations.definition")}
        csv={{ filename: "automation-runs", rows: automations.runs }}
      >
        <ReportsKpiRow
          kpis={[
            {
              label: tr("reports.team.automations.success"),
              definition: tr("reports.team.automations.success.definition"),
              value: share(automations.succeeded, automations.finished),
            },
            {
              label: tr("reports.team.automations.duration"),
              definition: tr("reports.team.automations.duration.definition"),
              value: automations.finished
                ? `${Math.round(automations.medianSeconds)}s`
                : "-",
              hint: tr("reports.overview.kpi.cycleTimeHint", {
                args: [`${Math.round(automations.p85Seconds)}s`],
              }),
            },
            {
              label: tr("reports.team.automations.broken"),
              definition: tr("reports.team.automations.broken.definition"),
              value: automations.broken.length,
            },
          ]}
        />
        <ReportsHistogram
          buckets={automations.runs.map((row) => ({
            label: tr(`reports.team.run.${row.status}`),
            count: row.count,
          }))}
          countLabel={tr("reports.team.automations.runs")}
        />
        {automations.broken.length > 0 && (
          <ul className="mt-2 text-sm" data-testid="reports-team-broken">
            {automations.broken.map((rule) => (
              <li key={rule.id} className="truncate py-1">
                {rule.title}
              </li>
            ))}
          </ul>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.team.mcp.title")}
        definition={tr("reports.team.mcp.definition")}
        csv={{ filename: "mcp-tools", rows: team.mcp }}
      >
        {team.mcp.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="reports-team-mcp">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium">
                    {tr("reports.team.mcp.tool")}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {tr("reports.team.mcp.ok")}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {tr("reports.team.mcp.refused")}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {tr("reports.team.mcp.error")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {team.mcp.map((row) => (
                  <tr key={row.tool}>
                    <td className="py-2 pr-4">{row.tool}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.ok}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.refused}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("reports.team.mcp.empty")}
          </p>
        )}
      </ReportsSection>

      <ReportsSection
        title={tr("reports.team.explorer.title")}
        definition={tr("reports.team.explorer.definition")}
      >
        <ReportsTeamExplorer />
      </ReportsSection>
    </>
  );
};

export default ReportsTeam;
