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
  /**
   * Declares a dataset before the container starts.
   *
   * Synchronous and eager by requirement, not by preference: a relational
   * backend has to have its tables registered before `migrate()` runs, and the
   * container is locked by then. Backends with nothing to declare — memory,
   * and Analytics Engine's hot tier — implement this as a no-op.
   */
  abstract register(dataset: AnalyticsDataset): void;

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
   * Deletes every row older than `before`, on whichever tier it lives.
   *
   * Deliberately not scoped to the rolled tier. Pruning only ever runs past
   * the cold boundary, which is always older than the hot one, so in
   * practice every row it removes has already been folded — but a provider
   * that reaches both tiers cannot strand an orphan if a rollup was ever
   * missed, and no caller can construct a case where the two scopings
   * differ.
   */
  abstract prune(dataset: AnalyticsDataset, before: string): Promise<void>;
}
