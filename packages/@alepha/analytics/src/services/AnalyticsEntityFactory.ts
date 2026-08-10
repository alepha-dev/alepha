import { type ZType, z } from "alepha";
import { $entity, type EntityPrimitive } from "alepha/orm";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

/**
 * Turns a dataset descriptor into the two tables a relational backend needs.
 *
 * **Two tables, not one.** The raw table holds hour buckets, the rolled table
 * holds day buckets, and keeping them apart is what makes the fold idempotent:
 * a row is either in one or the other, never half-folded, so a re-run over an
 * already-folded window inserts nothing new.
 *
 * The tables are derived rather than declared because a dataset's columns come
 * from a runtime descriptor, and `$repository()` needs its entity at
 * class-field declaration time. Registration therefore goes through
 * `DatabaseProvider.registerEntity`, which is the same call `Repository`
 * makes and is what puts a table into the migration snapshot.
 *
 * `bucket` rather than `hour` as the column name on both tables: it holds an
 * hour key in one and a day key in the other, and naming it for the finer of
 * the two would make the rolled table read like a lie.
 */
export class AnalyticsEntityFactory {
  public static build(dataset: AnalyticsDataset): {
    raw: EntityPrimitive;
    rolled: EntityPrimitive;
  } {
    const columns: Record<string, ZType> = {
      bucket: z.string(),
      ...dataset.dimensions.shape,
      ...dataset.measures.shape,
    };

    const keys = ["bucket", ...Object.keys(dataset.dimensions.shape).sort()];

    return {
      raw: $entity({
        name: `analytics_${dataset.name}_raw`,
        schema: z.object(columns),
        indexes: [{ columns: keys, unique: true }],
      }) as EntityPrimitive,
      rolled: $entity({
        name: `analytics_${dataset.name}_rolled`,
        schema: z.object(columns),
        indexes: [{ columns: keys, unique: true }],
      }) as EntityPrimitive,
    };
  }
}
