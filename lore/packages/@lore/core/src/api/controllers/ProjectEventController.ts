import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { projectEventCatalogPageSchema } from "../schemas/projectEventCatalogPageSchema.ts";
import { projectEventFilterOptionsSchema } from "../schemas/projectEventFilterOptionsSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectEventCatalogService } from "../services/ProjectEventCatalogService.ts";
import { ProjectEventFilters } from "../services/ProjectEventFilters.ts";

/**
 * The events a project can emit, and what a subscription's filter may name
 * (#Q3892). Membership gates both: every member subscribes themselves.
 */
export class ProjectEventController {
  protected readonly catalog = $inject(ProjectEventCatalogService);
  protected readonly filters = $inject(ProjectEventFilters);
  protected readonly gate = $ownsProject({ param: "projectId" });

  getProjectEventCatalog = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/event-catalog",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: projectEventCatalogPageSchema,
    },
    handler: async ({ params }) => ({
      items: await this.catalog.describe(params.projectId),
    }),
  });

  getProjectEventFilterOptions = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/event-filters/:resource",
    schema: {
      params: z.object({
        projectId: z.integer(),
        resource: z.enum(["host", "app", "monitor"]),
      }),
      response: projectEventFilterOptionsSchema,
    },
    handler: async ({ params }) => ({
      items: await this.filters.options(params.projectId, params.resource),
    }),
  });
}
