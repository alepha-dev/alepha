import type { ZObject } from "alepha";

/**
 * The shape a dataset declares.
 *
 * Dimensions are the low-cardinality strings you group and filter by; measures
 * are the numbers you aggregate. Both are `z.object(...)` so a dataset reads
 * exactly like an `$entity({ name, schema: z.object({...}) })`.
 */
export interface AnalyticsDataset {
  /**
   * Storage-facing name. Becomes the `blob1` discriminator on Analytics
   * Engine and the table prefix on a relational backend.
   */
  name: string;

  /**
   * Which dimension becomes Analytics Engine's single index.
   *
   * Required rather than inferred: Workers Analytics Engine has exactly one
   * 96-byte index and samples equitably per index value, so the wrong choice
   * silently degrades data quality rather than failing.
   */
  index: string;

  dimensions: ZObject;
  measures: ZObject;

  retention?: AnalyticsRetention;
}

export interface AnalyticsRetention {
  /**
   * How long raw hour-bucketed rows are kept, e.g. `"60d"`.
   */
  hot?: string;
  /**
   * Bucket granularity past the hot window. Only `"day"` exists today.
   */
  rollup?: "day";
  /**
   * How long rolled rows are kept before deletion, e.g. `"400d"`.
   */
  cold?: string;
}
