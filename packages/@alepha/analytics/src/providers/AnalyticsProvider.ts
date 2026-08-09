import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";

/**
 * One recorded event: every dimension, every measure, and its hour bucket.
 */
export type AnalyticsRow = Record<string, string | number> & { hour: string };

/**
 * Where a dataset's rows live.
 *
 * **Each provider owns its own tiering.** Nothing above this seam knows that
 * hot and rolled data exist, because the two shipped backends tier into
 * different *systems* rather than different tables: the relational provider
 * keeps a raw table and a rolled table in one database, while the Analytics
 * Engine provider keeps hot rows in Analytics Engine and rolled rows in a
 * relational store. A tier-aware planner above this line would have to know
 * both layouts.
 */
export abstract class AnalyticsProvider {
  abstract record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void>;

  abstract query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult>;

  /**
   * Folds hour buckets into day buckets for everything older than `before`.
   *
   * Must be idempotent: the job that drives it is capped per sweep and resumes
   * where it stopped, so re-running over an already-folded window has to be a
   * no-op rather than a double-count.
   */
  abstract rollup(dataset: AnalyticsDataset, before: string): Promise<void>;

  /**
   * Deletes rolled rows older than `before`.
   */
  abstract prune(dataset: AnalyticsDataset, before: string): Promise<void>;
}
