import { $ownsProject } from "@lore/core/api";
import {
  reportsMembersSchema,
  reportsBacklogSchema,
  reportsFlowSchema,
  reportsOverviewSchema,
  reportsPlanningSchema,
  reportsQuerySchema,
  reportsQuestsSchema,
} from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectBacklogReportService } from "../services/ProjectBacklogReportService.ts";
import { ProjectFlowReportService } from "../services/ProjectFlowReportService.ts";
import { ProjectPlanningReportService } from "../services/ProjectPlanningReportService.ts";
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
  protected readonly flow = $inject(ProjectFlowReportService);
  protected readonly backlog = $inject(ProjectBacklogReportService);
  protected readonly planning = $inject(ProjectPlanningReportService);

  /**
   * Reports "Flow" tab: how work moved through the period (#Q3000).
   */
  getReportsFlow = $action({
    path: "/getReportsFlow/:id",
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
      query: reportsQuerySchema,
      response: reportsFlowSchema,
    },
    handler: ({ params, query }) => this.flow.report(params.id, query),
  });

  /**
   * Reports "Backlog" tab: the open work as it stands (#Q3002).
   */
  getReportsBacklog = $action({
    path: "/getReportsBacklog/:id",
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
      query: reportsQuerySchema,
      response: reportsBacklogSchema,
    },
    handler: ({ params, query }) => this.backlog.report(params.id, query),
  });

  /**
   * Reports "Planning" tab: epics and releases (#Q3003).
   */
  getReportsPlanning = $action({
    path: "/getReportsPlanning/:id",
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
      query: reportsQuerySchema,
      response: reportsPlanningSchema,
    },
    handler: ({ params, query }) => this.planning.report(params.id, query),
  });

  /**
   * Reports "Overview" tab: KPI tiles, a cumulative created-vs-completed
   * burn-up chart, a weekly completion-rate trend, and counts of quests that
   * need attention (stale, not started, blocked).
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
      query: reportsQuerySchema,
      response: reportsOverviewSchema,
    },
    handler: ({ params, query }) => this.reports.overview(params.id, query),
  });

  /**
   * Reports "Quests" tab: a lifecycle funnel (to do → in progress → completed),
   * completed-vs-remaining breakdowns by area and by priority, median cycle
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
      query: reportsQuerySchema,
      response: reportsQuestsSchema,
    },
    handler: ({ params, query }) => this.reports.questsReport(params.id, query),
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
      query: reportsQuerySchema,
      response: reportsMembersSchema,
    },
    handler: ({ params, query }) =>
      this.reports.membersReport(params.id, query),
  });
}
