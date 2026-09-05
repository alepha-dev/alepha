import { $inject, z } from "alepha";
import {
  adminAnalyticsQuerySchema,
  adminAnalyticsResultSchema,
  adminDatasetSchema,
} from "alepha/api/analytics";
import { $action } from "alepha/server";

import { ShowcaseAnalytics } from "./ShowcaseAnalytics.ts";

/**
 * Stands in for `AdminAnalyticsController`.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * Unlike every other fixture here, `queryDataset` computes its answer from the
 * request instead of returning a canned one. The explorer lets a reader change
 * the grouping, the window and the measures, and a fixed result would answer
 * every question identically - which reads as controls that do nothing.
 */
export class ShowcaseAnalyticsController {
  protected readonly analytics = $inject(ShowcaseAnalytics);

  public readonly listDatasets = $action({
    path: "/admin/analytics/datasets",
    schema: {
      response: z.array(adminDatasetSchema),
    },
    handler: () => this.analytics.datasets(),
  });

  public readonly queryDataset = $action({
    method: "POST",
    path: "/admin/analytics/datasets/:name/query",
    schema: {
      params: z.object({ name: z.text() }),
      body: adminAnalyticsQuerySchema,
      response: adminAnalyticsResultSchema,
    },
    handler: ({ body }) => this.analytics.query(body),
  });
}
