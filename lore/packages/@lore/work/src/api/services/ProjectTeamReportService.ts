import { ProjectAnalytics } from "@lore/core/api";
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
    const [people, scope, activity] = await Promise.all([
      this.reports.membersOf(projectId),
      this.reports.scopeOf(projectId, query),
      this.datasets.activity.query({
        // An analytics query always has a lower bound: "all" is all it keeps.
        since: query.from?.slice(0, 10) ?? "2000-01-01",
        ...(query.to ? { until: query.to.slice(0, 10) } : {}),
        where: { project: String(projectId) },
        groupBy: ["actor", "type", "action", "channel"],
        select: { count: "sum" },
      }),
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
      estimated: activity.estimated === true,
    };
  }
}

type ContributionFigure =
  | "questsCreated"
  | "questsCompleted"
  | "comments"
  | "folioRevisions"
  | "feedbackTriaged"
  | "deploys";
