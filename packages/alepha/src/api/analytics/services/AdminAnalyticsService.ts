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
 * Narrows this service to one slice of the data.
 *
 * A caller that may only ever see part of a dataset (one tenant, one app)
 * passes the dimension values that define its slice. Those values are forced
 * onto every query AND removed from the published descriptor, which is what
 * makes a generic UI safe on a scoped surface: a dimension the descriptor
 * never mentions cannot be grouped by, filtered on, or offered as a filter
 * value, without a single line of the UI knowing that a scope exists.
 *
 * The pin is therefore not a default the caller may override. It is a
 * vocabulary restriction: naming a pinned key in `where` or `groupBy` is a
 * `BadRequestError`, never a silent overwrite. Silently overwriting would
 * answer a question nobody asked, and it is the shape in which a scoped
 * surface leaks — the caller believes it filtered and it did not.
 */
export interface AdminAnalyticsScope {
  /**
   * Dimension values that define the caller's slice, e.g. `{ sigilId }`.
   */
  pin?: Record<string, string | number>;
}

/**
 * Read-only admin surface over every `$analytics()` dataset in the container.
 *
 * Enumeration goes through `alepha.primitives($analytics)` — the same call
 * `AnalyticsRollupJobs` uses — so a dataset declared anywhere is visible here
 * with no registration step. Key membership is validated against the
 * declaration before a query reaches the provider: the closed query language
 * is what makes a generic admin UI safe, and this service is where "closed"
 * is enforced for the keys the zod wire schema cannot know.
 *
 * Both methods take an optional {@link AdminAnalyticsScope}. Without one this
 * is the unrestricted admin surface it has always been; with one it is the
 * same surface narrowed to a slice, which is what lets an app expose the
 * query builder to a non-admin without a second implementation of the query
 * language to keep in step.
 */
export class AdminAnalyticsService {
  protected readonly alepha = $inject(Alepha);

  protected get primitives(): AnalyticsPrimitive[] {
    return this.alepha.primitives($analytics);
  }

  public listDatasets(scope?: AdminAnalyticsScope): AdminDatasetDescriptor[] {
    const pinned = Object.keys(scope?.pin ?? {});
    return this.primitives
      .filter((primitive) => this.narrowable(primitive, pinned))
      .map((primitive) => {
        const dataset = primitive.dataset;
        return {
          name: dataset.name,
          index: dataset.index,
          dimensions: this.withoutPinned(
            z.toJSONSchema(dataset.dimensions) as Record<string, any>,
            pinned,
          ),
          measures: z.toJSONSchema(dataset.measures) as Record<string, any>,
          retention: dataset.retention,
        };
      });
  }

  public async queryDataset(
    name: string,
    query: AdminAnalyticsQuery,
    scope?: AdminAnalyticsScope,
  ): Promise<AnalyticsResult> {
    const pin = scope?.pin ?? {};
    const pinned = Object.keys(pin);
    const primitive = this.primitives.find((p) => p.dataset.name === name);
    // A dataset the pin cannot narrow is answered as unknown rather than as
    // forbidden, because `listDatasets` never offered it: from this caller's
    // vocabulary it genuinely does not exist, and saying "exists but not for
    // you" would publish the shape of everything the scope hides.
    if (!primitive || !this.narrowable(primitive, pinned)) {
      throw new NotFoundError(`Unknown analytics dataset '${name}'.`);
    }
    this.assertKeysDeclared(primitive, query, pinned);
    if (pinned.length === 0) {
      return primitive.query(query);
    }
    // The pin goes on last, but nothing it could overwrite survived
    // `assertKeysDeclared` — a caller that named a pinned key was already
    // refused, so this spread can only ever add.
    return primitive.query({ ...query, where: { ...query.where, ...pin } });
  }

  /**
   * Whether every pinned dimension is one this dataset actually declares.
   *
   * A dataset with no such column cannot be narrowed to the caller's slice,
   * so the only safe answers are to hide it or to serve it whole. It is
   * hidden: the alternative hands a scoped caller the entire dataset the one
   * time the scope was needed most.
   */
  protected narrowable(
    primitive: AnalyticsPrimitive,
    pinned: string[],
  ): boolean {
    const dimensions = Object.keys(primitive.dataset.dimensions.shape);
    return pinned.every((key) => dimensions.includes(key));
  }

  /**
   * The dimensions JSON Schema with the pinned keys taken out, so the scope
   * is invisible rather than merely discouraged.
   *
   * Returns the schema untouched when nothing is pinned: the admin surface
   * must keep publishing byte-identical descriptors.
   */
  protected withoutPinned(
    schema: Record<string, any>,
    pinned: string[],
  ): Record<string, any> {
    if (pinned.length === 0) {
      return schema;
    }
    const properties = { ...schema.properties };
    for (const key of pinned) {
      delete properties[key];
    }
    const next: Record<string, any> = { ...schema, properties };
    if (Array.isArray(schema.required)) {
      next.required = schema.required.filter(
        (key: string) => !pinned.includes(key),
      );
    }
    return next;
  }

  /**
   * Refuses keys the dataset never declared. `hour` and `day` are the two
   * pseudo-dimensions every dataset can group by.
   *
   * A pinned key is treated as undeclared, which is what collapses the whole
   * scope check into one filter: the caller's vocabulary is exactly what the
   * descriptor published, so `where` and `groupBy` are both refused on a
   * pinned dimension without either loop knowing about scopes. The message
   * says pinned rather than unknown, because the key IS a real dimension and
   * an operator reading a 400 deserves the true reason.
   */
  protected assertKeysDeclared(
    primitive: AnalyticsPrimitive,
    query: AdminAnalyticsQuery,
    pinned: string[] = [],
  ): void {
    const dimensions = new Set(
      Object.keys(primitive.dataset.dimensions.shape).filter(
        (key) => !pinned.includes(key),
      ),
    );
    const measures = Object.keys(primitive.dataset.measures.shape);
    const reason = (key: string) =>
      pinned.includes(key)
        ? `'${key}' is pinned by this surface and cannot be set.`
        : `'${key}' is not a dimension of '${primitive.dataset.name}'.`;

    for (const key of Object.keys(query.where ?? {})) {
      if (!dimensions.has(key)) {
        throw new BadRequestError(reason(key));
      }
    }
    for (const key of query.groupBy ?? []) {
      if (!dimensions.has(key) && key !== "hour" && key !== "day") {
        throw new BadRequestError(
          pinned.includes(key)
            ? reason(key)
            : `Cannot group by '${key}' on '${primitive.dataset.name}'.`,
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
