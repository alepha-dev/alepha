import { $inject, Alepha, z } from "alepha";
import { BadRequestError, NotFoundError } from "alepha/server";

import {
  $analytics,
  type AnalyticsPrimitive,
} from "../primitives/$analytics.ts";
import type { AdminAnalyticsQuery } from "../schemas/adminAnalyticsQuerySchema.ts";
import type { AdminDatasetDescriptor } from "../schemas/adminDatasetSchema.ts";
import type { AnalyticsResult } from "../schemas/analyticsQuerySchema.ts";

/**
 * Read-only admin surface over every `$analytics()` dataset in the container.
 *
 * Enumeration goes through `alepha.primitives($analytics)` — the same call
 * `AnalyticsRollupJobs` uses — so a dataset declared anywhere is visible here
 * with no registration step. Key membership is validated against the
 * declaration before a query reaches the provider: the closed query language
 * is what makes a generic admin UI safe, and this service is where "closed"
 * is enforced for the keys the zod wire schema cannot know.
 */
export class AdminAnalyticsService {
  protected readonly alepha = $inject(Alepha);

  protected get primitives(): AnalyticsPrimitive[] {
    return this.alepha.primitives($analytics);
  }

  public listDatasets(): AdminDatasetDescriptor[] {
    return this.primitives.map((primitive) => {
      const dataset = primitive.dataset;
      return {
        name: dataset.name,
        index: dataset.index,
        dimensions: z.toJSONSchema(dataset.dimensions) as Record<string, any>,
        measures: z.toJSONSchema(dataset.measures) as Record<string, any>,
        retention: dataset.retention,
      };
    });
  }

  public async queryDataset(
    name: string,
    query: AdminAnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const primitive = this.primitives.find((p) => p.dataset.name === name);
    if (!primitive) {
      throw new NotFoundError(`Unknown analytics dataset '${name}'.`);
    }
    this.assertKeysDeclared(primitive, query);
    return primitive.query(query);
  }

  /**
   * Refuses keys the dataset never declared. `hour` and `day` are the two
   * pseudo-dimensions every dataset can group by.
   */
  protected assertKeysDeclared(
    primitive: AnalyticsPrimitive,
    query: AdminAnalyticsQuery,
  ): void {
    const dimensions = Object.keys(primitive.dataset.dimensions.shape);
    const measures = Object.keys(primitive.dataset.measures.shape);

    for (const key of Object.keys(query.where ?? {})) {
      if (!dimensions.includes(key)) {
        throw new BadRequestError(
          `'${key}' is not a dimension of '${primitive.dataset.name}'.`,
        );
      }
    }
    for (const key of query.groupBy ?? []) {
      if (!dimensions.includes(key) && key !== "hour" && key !== "day") {
        throw new BadRequestError(
          `Cannot group by '${key}' on '${primitive.dataset.name}'.`,
        );
      }
    }
    for (const key of Object.keys(query.select)) {
      if (!measures.includes(key)) {
        throw new BadRequestError(
          `'${key}' is not a measure of '${primitive.dataset.name}'.`,
        );
      }
    }
  }
}
