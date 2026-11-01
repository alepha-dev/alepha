import { $ownsProject, ProjectReportRegistry } from "@lore/core/api";
import { type ReportsQuery, reportsQuerySchema } from "@lore/core/schemas";
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
  protected readonly sections = $inject(ProjectReportRegistry);

  constructor() {
    this.sections.register("delivery", (id, query) => this.report(id, query));
  }

  protected async report(id: number, query: ReportsQuery) {
    const [delivery, quality] = await Promise.all([
      this.reports.report(id, query),
      this.quality.report(id, query, (run) => this.qualityApi.resource(run)),
    ]);
    return { ...delivery, quality };
  }

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
    handler: ({ params, query }) => this.report(params.id, query),
  });
}
