import { ProjectAnalytics, ProjectAutomationReport } from "@lore/core/api";
import type { ReportsQuery, ReportsTeam } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * The Team tab's report (#Q3013): what each member is carrying, what they did
 * in the period, and how the work arrived. It replaces a leaderboard, so it
 * ranks nobody: a triager or a folio writer completes no quest and is not idle.
 *
 * The contribution reads `project_activity`, which carries neither area nor
 * epic, so the tab honours the period alone. A point written before `channel`
 * existed is an empty slot on Analytics Engine, folded into `unknown` here and
 * never into `web`: that would credit an old agent write to a person.
 */
export class ProjectTeamReportService {
  protected readonly quests = $repository(quests);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly datasets = $inject(ProjectAnalytics);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly automations = $inject(ProjectAutomationReport);

  /**
   * The figure an activity point feeds, by `type:action`.
   */
  protected readonly figures: Record<string, ContributionFigure> = {
    "quest:create": "questsCreated",
    "quest:complete": "questsCompleted",
    "quest:comment": "comments",
    "feedback:comment": "comments",
    "folio:create": "folioRevisions",
    "folio:update": "folioRevisions",
    "folio:revert": "folioRevisions",
    "feedback:accept": "feedbackTriaged",
    "feedback:reject": "feedbackTriaged",
    "app:deploy": "deploys",
  };

  async report(projectId: number, query: ReportsQuery): Promise<ReportsTeam> {
    const since = query.from?.slice(0, 10) ?? "2000-01-01";
    const until = query.to ? { until: query.to.slice(0, 10) } : {};
    const project = String(projectId);
    const [people, scope, activity, heatmap, mcp, automations] =
      await Promise.all([
        this.reports.membersOf(projectId),
        this.reports.scopeOf(projectId, query),
        this.datasets.activity.query({
          // An analytics query always has a lower bound: "all" is all it keeps.
          since,
          ...until,
          where: { project },
          groupBy: ["actor", "type", "action", "channel"],
          select: { count: "sum" },
        }),
        this.heatmap(project, since, until),
        this.datasets.mcpCalls.query({
          since,
          ...until,
          where: { project },
          groupBy: ["tool", "outcome"],
          select: { count: "sum" },
        }),
        this.automations.read(projectId, query),
      ]);
    const open = await this.quests.findMany({
      where: {
        ...scope,
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
      },
      columns: ["acceptedBy", "heldBy", "heldAt", "dueAt"],
    });

    const members = new Map(
      people.map((person) => [
        person.userId,
        {
          ...person,
          wip: 0,
          held: 0,
          overdue: 0,
          questsCreated: 0,
          questsCompleted: 0,
          comments: 0,
          folioRevisions: 0,
          feedbackTriaged: 0,
          deploys: 0,
          writes: 0,
          agentWrites: 0,
        },
      ]),
    );

    const now = this.dt.nowMillis();
    for (const quest of open) {
      const member = members.get(quest.acceptedBy ?? quest.heldBy ?? "");
      if (!member) continue;
      if (quest.heldAt) {
        member.held += 1;
      } else {
        member.wip += 1;
      }
      if (quest.dueAt && this.dt.of(quest.dueAt).valueOf() < now) {
        member.overdue += 1;
      }
    }

    const channels = new Map<string, number>();
    for (const row of activity.rows) {
      const count = Number(row.count) || 0;
      const channel = String(row.channel) || "unknown";
      channels.set(channel, (channels.get(channel) ?? 0) + count);

      const member = members.get(String(row.actor));
      if (!member) continue;
      member.writes += count;
      if (channel === "mcp") {
        member.agentWrites += count;
      }
      const figure = this.figures[`${row.type}:${row.action}`];
      if (figure) {
        member[figure] += count;
      }
    }

    return {
      members: [...members.values()].toSorted((a, b) =>
        a.name.localeCompare(b.name),
      ),
      channels: [...channels]
        .map(([channel, count]) => ({ channel, count }))
        .toSorted((a, b) => b.count - a.count),
      heatmap,
      automations,
      mcp: this.mcpTools(mcp.rows),
      estimated: activity.estimated === true || mcp.estimated === true,
    };
  }

  /**
   * Writes per weekday and hour. Hours exist in the hot tier alone, so the
   * window stops at its 30 days: a rolled row would answer in days, under a key
   * that folds into no cell.
   */
  protected async heatmap(
    project: string,
    since: string,
    until: { until?: string },
  ): Promise<number[][]> {
    const hot = this.dt.now().subtract(30, "day").toISOString().slice(0, 10);
    const { rows } = await this.datasets.activity.query({
      since: since > hot ? since : hot,
      ...until,
      where: { project },
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    const grid = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0),
    );
    for (const row of rows) {
      const key = String(row.hour);
      const at = new Date(`${key.slice(0, 13)}:00:00.000Z`);
      const hour = at.getUTCHours();
      const cells = grid[(at.getUTCDay() + 6) % 7];
      if (cells) {
        cells[hour] = (cells[hour] ?? 0) + (Number(row.count) || 0);
      }
    }
    return grid;
  }

  protected mcpTools(rows: Array<Record<string, unknown>>): ReportsTeam["mcp"] {
    const tools = new Map<string, ReportsTeam["mcp"][number]>();
    for (const row of rows) {
      const tool = String(row.tool);
      const entry = tools.get(tool) ?? { tool, ok: 0, refused: 0, error: 0 };
      const count = Number(row.count) || 0;
      if (row.outcome === "refused") {
        entry.refused += count;
      } else if (row.outcome === "error") {
        entry.error += count;
      } else {
        entry.ok += count;
      }
      tools.set(tool, entry);
    }
    const calls = (entry: ReportsTeam["mcp"][number]) =>
      entry.ok + entry.refused + entry.error;
    return [...tools.values()].toSorted((a, b) => calls(b) - calls(a));
  }
}

type ContributionFigure =
  | "questsCreated"
  | "questsCompleted"
  | "comments"
  | "folioRevisions"
  | "feedbackTriaged"
  | "deploys";
