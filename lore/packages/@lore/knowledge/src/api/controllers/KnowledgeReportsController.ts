import { $ownsProject, ProjectReportRegistry } from "@lore/core/api";
import { reportsKnowledgeSchema, reportsQuerySchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { ProjectKnowledgeReportService } from "../services/ProjectKnowledgeReportService.ts";

/**
 * The Reports Knowledge tab (#Q3007).
 */
export class KnowledgeReportsController {
  protected readonly reports = $inject(ProjectKnowledgeReportService);
  protected readonly sections = $inject(ProjectReportRegistry);

  constructor() {
    this.sections.register("knowledge", (id, query) =>
      this.reports.report(id, query),
    );
  }

  getReportsKnowledge = $action({
    path: "/getReportsKnowledge/:id",
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
      response: reportsKnowledgeSchema,
    },
    handler: ({ params, query }) => this.reports.report(params.id, query),
  });
}
