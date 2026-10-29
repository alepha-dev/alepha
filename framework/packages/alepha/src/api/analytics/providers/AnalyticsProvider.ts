import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";

/**
 * One stored row: its bucket, every dimension, and every measure column.
 *
 * A sum-only measure is one column named after itself, so for a dataset
 * without gauges this is simply the recorded event. A measure with other
 * folds is one column per fold (`<measure>_<fold>`, plus
 * `<measure>_last_at`), `null` where the bucket holds no reading; see
 * `AnalyticsFolds`. `$analytics` hands a provider rows with distinct
 * `(hour, ...dimensions)` keys, already folded.
 */
export type AnalyticsRow = Record<string, string | number | null> & {
  hour: string;
};

/**
 * A storage tier of a dataset, by its index in the retention chain
 * (`AnalyticsTiers.of`): `0` holds the finest buckets as recorded, the last
 * the coarsest they fold into.
 */
export type AnalyticsTier = number;

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
   * Whether the backend stores every value as written. `false` for a
   * sampling backend (Analytics Engine), which can reconstruct a `sum` but
   * not an extreme or a last value, so a dataset declaring `min`, `max` or
   * `last` is refused at boot there.
   */
  abstract readonly exact: boolean;

  /**
   * Whether `record()` already returns before the write lands, as a batch
   * the platform flushes (Analytics Engine). A dataset's `buffer` is
   * ignored there, with an info log at boot: it would add a second buffer
   * in front of the first.
   */
  public readonly fireAndForget: boolean = false;

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
   * Folds every row of tier `fromTier` whose bucket is before `before` into
   * tier `fromTier + 1`, its key truncated to that tier's resolution, then
   * deletes the folded rows. `before` is read at the target tier's
   * resolution, so only whole target buckets fold.
   *
   * Must be idempotent: the job that drives it is capped per sweep and resumes
   * where it stopped, so re-running over an already-folded window has to be a
   * no-op rather than a double-count.
   */
  abstract rollup(
    dataset: AnalyticsDataset,
    fromTier: AnalyticsTier,
    before: string,
  ): Promise<void>;

  /**
   * Deletes every row older than `before`, on whichever tier it lives.
   *
   * Deliberately not scoped to the last tier. Pruning only ever runs past the
   * last tier's window, which is the longest of the chain, so in practice
   * every row it removes has already been folded into the last tier — but a
   * provider that reaches every tier cannot strand an orphan if a rollup was
   * ever missed, and no caller can construct a case where the two scopings
   * differ.
   *
   * A provider may stop short of `before` to bound one call, as
   * `OrmAnalyticsProvider` does (see its `MAX_PRUNE_BUCKETS`): the job that
   * drives it sweeps hourly under a timeout, and the next sweep resumes from
   * whatever is still oldest. A provider that stops short must still delete
   * the oldest rows first, so every call makes progress.
   */
  abstract prune(dataset: AnalyticsDataset, before: string): Promise<void>;

  /**
   * The oldest bucket key `tier` still holds for `dataset`, or `undefined`
   * when the tier is empty.
   *
   * The rollup sweep's resume point. It used to be derived from a full
   * `query()` grouped by hour, which made the database aggregate every row of
   * both tiers just to find one key; relationally this is an indexed
   * `MIN(time_bucket)`, since the unique index leads with the bucket.
   */
  abstract oldestBucket(
    dataset: AnalyticsDataset,
    tier: AnalyticsTier,
  ): Promise<string | undefined>;
}
