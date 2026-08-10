import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";

/**
 * Declares an analytics dataset: what you record, and what you can ask.
 *
 * The same declaration runs on Workers Analytics Engine, on a relational
 * database and in memory. Which one is bound is a runtime decision made by the
 * module, so app code never names a backend.
 *
 * @example
 * ```ts
 * class PageViews {
 *   views = $analytics({
 *     index: "app",
 *     dimensions: z.object({ app: z.text(), path: z.text(), country: z.text() }),
 *     measures: z.object({ count: z.integer() }),
 *     retention: { hot: "60d", rollup: "day", cold: "400d" },
 *   });
 *
 *   async onPageView(app: string, path: string, country: string) {
 *     await this.views.record({ app, path, country, count: 1 });
 *   }
 *
 *   async topPaths(app: string) {
 *     return this.views.query({
 *       since: "2026-01-01",
 *       where: { app },
 *       groupBy: ["path"],
 *       select: { count: "sum" },
 *       orderBy: { key: "count", direction: "desc" },
 *       limit: 20,
 *     });
 *   }
 * }
 * ```
 */
export const $analytics = (options: AnalyticsPrimitiveOptions) =>
  createPrimitive(AnalyticsPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface AnalyticsPrimitiveOptions
  extends Omit<AnalyticsDataset, "name"> {
  /**
   * Storage-facing dataset name. Defaults to the property key it is declared
   * on, the same way `$storage` names a bucket.
   */
  name?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AnalyticsPrimitive extends Primitive<AnalyticsPrimitiveOptions> {
  protected readonly provider = $inject(AnalyticsProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  public get dataset(): AnalyticsDataset {
    return {
      ...this.options,
      name: this.options.name ?? this.config.propertyKey,
    };
  }

  /**
   * Validates the dataset and registers it with the bound provider.
   *
   * `onInit` rather than a lifecycle hook or first use, and synchronous by
   * requirement of the base class. Both halves have to happen here:
   *
   * - The slot caps and the index check are cheap, and their failure mode is a
   *   wire format that silently misreads stored rows — so they are asserted at
   *   boot rather than at the first write.
   * - Registration must precede `alepha.start()`. The container locks once
   *   `started` flips (`Alepha.ts:1079`), and a relational provider's
   *   `migrate()` runs from its own `"start"` hook
   *   (`PostgresProvider.ts:91-106`), so a dataset registered any later has no
   *   table and cannot get one. This is the same rule `Repository`'s own
   *   constructor follows (`Repository.ts:123-127`).
   */
  protected onInit(): void {
    AnalyticsSlotMap.forDataset(this.dataset);
    this.provider.register(this.dataset);
  }

  public async record(
    row: Record<string, string | number> & { hour?: string },
  ): Promise<void> {
    await this.recordMany([row]);
  }

  /**
   * Records a batch.
   *
   * `hour` is stamped from {@link DateTimeProvider} unless the caller supplies
   * one. The override is load-bearing rather than a convenience: Analytics
   * Engine stamps its own `timestamp` at write time and cannot backdate a
   * point, so a batched or retried envelope has to carry the bucket it
   * computed or it lands in the wrong hour for reasons unrelated to sampling.
   */
  public async recordMany(
    rows: Array<Record<string, string | number> & { hour?: string }>,
  ): Promise<void> {
    const fallback = AnalyticsBuckets.hour(this.dateTime.nowMillis());
    await this.provider.record(
      this.dataset,
      rows.map((row) => ({ ...row, hour: row.hour ?? fallback })),
    );
  }

  public query(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.provider.query(this.dataset, query);
  }
}

$analytics[KIND] = AnalyticsPrimitive;
