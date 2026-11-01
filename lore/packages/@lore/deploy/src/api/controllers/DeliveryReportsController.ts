import { $ownsProject } from "@lore/core/api";
import { reportsDeliverySchema, reportsQuerySchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectDeliveryReportService } from "../services/ProjectDeliveryReportService.ts";

/**
 * The Reports Delivery tab (#Q3008).
 */
export class DeliveryReportsController {
  protected readonly reports = $inject(ProjectDeliveryReportService);

  getReportsDelivery = $action({
    path: "/getReportsDelivery/:id",
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
      response: reportsDeliverySchema,
    },
    handler: ({ params, query }) => this.reports.report(params.id, query),
  });
}
