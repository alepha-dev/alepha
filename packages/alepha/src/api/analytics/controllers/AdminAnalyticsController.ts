import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { adminAnalyticsQuerySchema } from "../schemas/adminAnalyticsQuerySchema.ts";
import { adminAnalyticsResultSchema } from "../schemas/adminAnalyticsResultSchema.ts";
import { adminDatasetSchema } from "../schemas/adminDatasetSchema.ts";
import { AdminAnalyticsService } from "../services/AdminAnalyticsService.ts";

/**
 * Admin-facing read surface over declared analytics datasets.
 *
 * Permissions follow the `admin:<module>:<verb>` convention so a role
 * granting `admin:*` covers this surface too.
 */
export class AdminAnalyticsController {
  protected readonly url = "/admin/analytics";
  protected readonly group = "admin:analytics";
  protected readonly service = $inject(AdminAnalyticsService);

  public readonly listDatasets = $action({
    path: `${this.url}/datasets`,
    group: this.group,
    use: [$secure({ permissions: ["admin:analytics:read"] })],
    description: "List declared analytics datasets",
    schema: {
      response: z.array(adminDatasetSchema),
    },
    handler: () => this.service.listDatasets(),
  });

  public readonly queryDataset = $action({
    method: "POST",
    path: `${this.url}/datasets/:name/query`,
    group: this.group,
    use: [$secure({ permissions: ["admin:analytics:read"] })],
    description: "Run an aggregate query against one dataset",
    schema: {
      params: z.object({ name: z.text() }),
      body: adminAnalyticsQuerySchema,
      response: adminAnalyticsResultSchema,
    },
    handler: ({ params, body }) => this.service.queryDataset(params.name, body),
  });
}
