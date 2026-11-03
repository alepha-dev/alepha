import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { reportsQuerySchema } from "../schemas/reportsQuerySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectReportRegistry } from "../services/ProjectReportRegistry.ts";

/**
 * One Reports section by name, for `project_report` and `lore project report`
 * (#Q3015): what the tab shows, and behind the same permission.
 */
export class ProjectReportController {
  protected readonly reports = $inject(ProjectReportRegistry);

  getProjectReport = $action({
    path: "/getProjectReport/:id/:section",
    method: "GET",
    use: [$ownsProject({ requires: "stats:read", param: "id" })],
    schema: {
      params: z.object({ id: z.integer(), section: z.text() }),
      query: reportsQuerySchema,
      response: z.record(z.text(), z.any()),
    },
    handler: ({ params, query }) =>
      this.reports.read(params.section, params.id, query),
  });
}
