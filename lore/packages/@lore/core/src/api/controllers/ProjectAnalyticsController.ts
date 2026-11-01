import { $inject, z } from "alepha";
import {
  adminAnalyticsQuerySchema,
  adminAnalyticsResultSchema,
  AdminAnalyticsService,
  adminDatasetSchema,
} from "alepha/api/analytics";
import { $action } from "alepha/server";

import { $ownsProject } from "../security/$ownsProject.ts";

/**
 * The Team tab's query explorer (#Q3014): the framework's analytics query
 * builder, narrowed to one project. `SigilAnalyticsController` does the same
 * for one app, and the reasoning there holds here.
 *
 * All of the narrowing is `AdminAnalyticsService`'s `pin`: it takes `project`
 * out of the published descriptors and refuses a body that names it, so the
 * scope is not a filter the UI applies. Only datasets declaring `project` come
 * back, which is `project_activity` and `mcp_calls` today.
 */
export class ProjectAnalyticsController {
  protected readonly url = "/projects/:projectId/analytics";
  protected readonly group = "project:analytics";

  protected service = $inject(AdminAnalyticsService);

  listProjectDatasets = $action({
    use: [$ownsProject({ requires: "stats:read", param: "projectId" })],
    method: "GET",
    path: `${this.url}/datasets`,
    group: this.group,
    description: "List the analytics datasets readable for one project",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(adminDatasetSchema),
    },
    handler: ({ params }) =>
      this.service.listDatasets({ pin: { project: String(params.projectId) } }),
  });

  queryProjectDataset = $action({
    use: [$ownsProject({ requires: "stats:read", param: "projectId" })],
    method: "POST",
    path: `${this.url}/datasets/:name/query`,
    group: this.group,
    description:
      "Run an aggregate query against one dataset, scoped to a project",
    schema: {
      params: z.object({ projectId: z.integer(), name: z.text() }),
      body: adminAnalyticsQuerySchema,
      response: adminAnalyticsResultSchema,
    },
    handler: ({ params, body }) =>
      this.service.queryDataset(params.name, body, {
        pin: { project: String(params.projectId) },
      }),
  });
}
