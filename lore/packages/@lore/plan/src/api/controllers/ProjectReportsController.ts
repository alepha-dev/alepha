import { $ownsProject, ProjectReportRegistry } from "@lore/core/api";
import {
  reportsBacklogSchema,
  reportsFlowSchema,
  reportsPlanningSchema,
  reportsQuerySchema,
  reportsSupportSchema,
  reportsTeamSchema,
} from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectBacklogReportService } from "../services/ProjectBacklogReportService.ts";
import { ProjectFlowReportService } from "../services/ProjectFlowReportService.ts";
import { ProjectPlanningReportService } from "../services/ProjectPlanningReportService.ts";
import { ProjectSupportReportService } from "../services/ProjectSupportReportService.ts";
import { ProjectTeamReportService } from "../services/ProjectTeamReportService.ts";

/**
 * The Reports tabs: gate on `stats:read`, cache privately, delegate.
 *
 * The queries live in the services since #Q2653, because the dashboard's flow
 * tiles read the same numbers and two copies of a query is the silent
 * disagreement a shared service exists to prevent.
 */
export class ProjectReportsController {
  protected readonly flow = $inject(ProjectFlowReportService);
  protected readonly backlog = $inject(ProjectBacklogReportService);
  protected readonly planning = $inject(ProjectPlanningReportService);
  protected readonly support = $inject(ProjectSupportReportService);
  protected readonly team = $inject(ProjectTeamReportService);
  protected readonly sections = $inject(ProjectReportRegistry);

  constructor() {
    const { sections } = this;
    sections.register("flow", (id, query) => this.flow.report(id, query));
    sections.register("backlog", (id, query) => this.backlog.report(id, query));
    sections.register("planning", (id, query) =>
      this.planning.report(id, query),
    );
    sections.register("support", (id, query) => this.support.report(id, query));
    sections.register("team", (id, query) => this.team.report(id, query));
  }

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
   * Reports "Support" tab: feedback from intake to shipped (#Q3006). Readable
   * with Support off, like any existing data: the tab is what the capability
   * gates.
   */
  getReportsSupport = $action({
    path: "/getReportsSupport/:id",
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
      response: reportsSupportSchema,
    },
    handler: ({ params, query }) => this.support.report(params.id, query),
  });

  /**
   * Reports "Team" tab: workload and contribution per member (#Q3013).
   */
  getReportsTeam = $action({
    path: "/getReportsTeam/:id",
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
      response: reportsTeamSchema,
    },
    handler: ({ params, query }) => this.team.report(params.id, query),
  });
}
