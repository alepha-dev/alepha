import { $ownsProject, ProjectReportRegistry } from "@lore/core/api";
import { type ReportsQuery, reportsQuerySchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { qualityReportSchema } from "../schemas/qualityReportSchema.ts";
import { ProjectQualityReportService } from "../services/ProjectQualityReportService.ts";
import { QualityController } from "./QualityController.ts";

/**
 * The Reports Quality tab (#Q3070): coverage and test totals pushed by CI, a
 * page of its own again after a day as a section of Delivery (#Q3010).
 */
export class QualityReportsController {
  protected readonly quality = $inject(ProjectQualityReportService);
  protected readonly qualityApi = $inject(QualityController);
  protected readonly sections = $inject(ProjectReportRegistry);

  constructor() {
    this.sections.register("quality", (id, query) => this.report(id, query));
  }

  protected report(id: number, query: ReportsQuery) {
    return this.quality.report(id, query, (run) =>
      this.qualityApi.resource(run),
    );
  }

  getReportsQuality = $action({
    path: "/getReportsQuality/:id",
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
      response: qualityReportSchema,
    },
    handler: ({ params, query }) => this.report(params.id, query),
  });
}
