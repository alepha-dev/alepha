import { $ownsProject } from "@lore/core/api";
import {
  reportsMembersSchema,
  reportsOverviewSchema,
  reportsQuestsSchema,
} from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectReportsService } from "../services/ProjectReportsService.ts";

/**
 * The Reports tabs: gate on `stats:read`, cache privately, delegate.
 *
 * The queries live in `ProjectReportsService` since #Q2653, because the
 * dashboard's flow tiles read the same numbers and two copies of a query is
 * the silent disagreement a shared service exists to prevent.
 */
export class ProjectReportsController {
  protected readonly reports = $inject(ProjectReportsService);

  /**
   * Reports "Overview" tab: KPI tiles, a cumulative created-vs-completed
   * burn-up chart, a weekly completion-rate trend, and counts of quests that
   * need attention (stale, unassigned, blocked).
   *
   * Members-only. Every date computation
   * dialect-branches (SQLite epoch-ms ints in production, Postgres timestamps
   * in tests).
   */
  getReportsOverview = $action({
    path: "/getReportsOverview/:id",
    method: "GET",
    use: [
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      $ownsProject({ requires: "stats:read", param: "id" }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsOverviewSchema,
    },
    handler: ({ params }) => this.reports.overview(params.id),
  });

  /**
   * Reports "Quests" tab: a lifecycle funnel (to do → in progress → completed),
   * completed-vs-remaining breakdowns by area and by priority, average cycle
   * time per priority, and an actionable list of the oldest still-open quests.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  getReportsQuests = $action({
    path: "/getReportsQuests/:id",
    method: "GET",
    use: [
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      $ownsProject({ requires: "stats:read", param: "id" }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsQuestsSchema,
    },
    handler: ({ params }) => this.reports.questsReport(params.id),
  });

  /**
   * Reports "Members" tab: a per-member leaderboard (completed quests), a
   * weekly per-contributor contribution matrix for a stacked-area chart, and
   * an "idle" list of members who have not completed a quest in the last 14
   * days.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  getReportsMembers = $action({
    path: "/getReportsMembers/:id",
    method: "GET",
    use: [
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      $ownsProject({ requires: "stats:read", param: "id" }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsMembersSchema,
    },
    handler: ({ params }) => this.reports.membersReport(params.id),
  });
}
