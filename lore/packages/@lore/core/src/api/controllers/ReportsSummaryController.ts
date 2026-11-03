import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { reportsQuerySchema } from "../schemas/reportsQuerySchema.ts";
import { reportsSummarySchema } from "../schemas/reportsSummarySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ReportsSummaryRegistry } from "../services/ReportsSummaryRegistry.ts";

/**
 * The Reports Summary tab: every enabled capability's period at a glance.
 */
export class ReportsSummaryController {
  protected readonly summary = $inject(ReportsSummaryRegistry);

  getReportsSummary = $action({
    path: "/getReportsSummary/:id",
    method: "GET",
    use: [
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      $ownsProject({ requires: "stats:read", param: "id" }),
    ],
    schema: {
      params: z.object({ id: z.integer() }),
      query: reportsQuerySchema,
      response: reportsSummarySchema,
    },
    handler: async ({ params, query }) => ({
      lines: await this.summary.lines(params.id, query),
    }),
  });
}
