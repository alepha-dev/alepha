import { $ownsProject } from "@lore/core/api";
import { reportsQuerySchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { deliveryReportSchema } from "../schemas/deliveryReportSchema.ts";
import { ProjectDeliveryReportService } from "../services/ProjectDeliveryReportService.ts";
import { ProjectQualityReportService } from "../services/ProjectQualityReportService.ts";
import { QualityController } from "./QualityController.ts";

/**
 * The Reports Delivery tab (#Q3008).
 */
export class DeliveryReportsController {
  protected readonly reports = $inject(ProjectDeliveryReportService);
  protected readonly quality = $inject(ProjectQualityReportService);
  protected readonly qualityApi = $inject(QualityController);

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
      response: deliveryReportSchema,
    },
    handler: async ({ params, query }) => {
      const [delivery, quality] = await Promise.all([
        this.reports.report(params.id, query),
        this.quality.report(params.id, query, (run) =>
          this.qualityApi.resource(run),
        ),
      ]);
      return { ...delivery, quality };
    },
  });
}
