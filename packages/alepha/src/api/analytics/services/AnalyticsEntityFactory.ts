import { AlephaError, type ZType, z } from "alepha";
import { $entity, type EntityPrimitive } from "alepha/orm";

import { AnalyticsFolds } from "../planner/AnalyticsFolds.ts";
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
 * The time column is named {@link TIME_COLUMN} (`time_bucket`) rather than the
 * shorter `bucket`, because `bucket` is a name real datasets use for an
 * ordinary dimension — a histogram bucket index, with a `count`/`samples`
 * measure alongside it, is this design's own recommended way to model a
 * histogram. A reserved `bucket` column would collide with exactly that
 * dimension: dimensions are spread into the column map after the literal, so
 * the time key would be silently overwritten by the dimension's value, and
 * the unique index would carry a duplicate column name. Workers Analytics
 * Engine is immune to this because its slots are positional rather than
 * named, so the same dataset shape never surfaces the problem there — only
 * on a relational backend, and only once real rows are queried.
 */
export class AnalyticsEntityFactory {
  /**
   * The one column name a dataset may not use for a dimension or a measure.
   */
  public static readonly TIME_COLUMN = "time_bucket";

  /**
   * Names a dataset may not give a dimension, because `groupBy` treats them as
   * time pseudo-dimensions and would shadow the real column forever.
   */
  public static readonly RESERVED_DIMENSIONS = ["day", "hour"];

  public static build(dataset: AnalyticsDataset): {
    raw: EntityPrimitive;
    rolled: EntityPrimitive;
  } {
    AnalyticsEntityFactory.assertNoCollisions(dataset);

    const columns: Record<string, ZType> = {
      [AnalyticsEntityFactory.TIME_COLUMN]: z.string(),
      ...dataset.dimensions.shape,
      ...AnalyticsEntityFactory.measureColumns(dataset),
    };

    const keys = [
      AnalyticsEntityFactory.TIME_COLUMN,
      ...Object.keys(dataset.dimensions.shape).sort(),
    ];

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

  /**
   * The value columns of a dataset.
   *
   * A sum-only measure is one column named after itself, with its declared
   * type, exactly as before folds existed, so no existing table changes. A
   * measure with any other fold is one nullable column per fold
   * (`<measure>_<fold>`), plus a nullable `<measure>_last_at` bigint of
   * millis when it declares `last`: a row may omit a gauge, and the absence
   * is stored as NULL rather than as a `0` that would pin every `min`.
   */
  public static measureColumns(
    dataset: AnalyticsDataset,
  ): Record<string, ZType> {
    const columns: Record<string, ZType> = {};
    for (const [measure, schema] of Object.entries(dataset.measures.shape)) {
      if (AnalyticsFolds.isSumOnly(dataset, measure)) {
        columns[measure] = schema as ZType;
        continue;
      }
      for (const fold of AnalyticsFolds.of(dataset, measure)) {
        columns[`${measure}_${fold}`] = z.number().nullable().optional();
      }
      if (AnalyticsFolds.of(dataset, measure).includes("last")) {
        columns[AnalyticsFolds.lastAt(measure)] = z
          .int64()
          .nullable()
          .optional();
      }
    }
    return columns;
  }

  /**
   * Refuses a dataset whose names would silently lose a column.
   *
   * Spreading dimensions and measures into one column map means a duplicate
   * name does not error — it overwrites, and the loser vanishes from the table
   * with nothing to show for it. Three ways that can happen, all rejected here
   * rather than at the first confusing query.
   *
   * **Public, and also called from `AnalyticsPrimitive.onInit`** — this used
   * to be reachable only from {@link build}, i.e. only from
   * `OrmAnalyticsProvider.register()`. `MemoryAnalyticsProvider.register()`
   * and `WaeAnalyticsProvider.register()` never call `build()` at all (they
   * have no relational table to derive), so a dataset with, say, a `day`
   * dimension used to pass every test — the bound provider under
   * `alepha.isTest()` is Memory — and only throw once a relational or
   * Analytics Engine deployment actually registered it. Hoisting the call
   * into the primitive's own `onInit` (which runs regardless of which
   * provider ends up bound) closes that gap; this stays here too as defence
   * in depth for a hand-built `AnalyticsDataset` passed straight to a
   * provider without going through `$analytics()`.
   */
  public static assertNoCollisions(dataset: AnalyticsDataset): void {
    const dimensions = Object.keys(dataset.dimensions.shape);
    const measures = Object.keys(dataset.measures.shape);

    for (const name of [...dimensions, ...measures]) {
      if (name === AnalyticsEntityFactory.TIME_COLUMN) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares '${name}', which is reserved for the time bucket. Rename it — on a relational backend it would overwrite the bucket column.`,
        );
      }
    }

    for (const name of dimensions) {
      if (AnalyticsEntityFactory.RESERVED_DIMENSIONS.includes(name)) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares '${name}' as a dimension, which is reserved as a time pseudo-dimension. A query's 'groupBy' always resolves '${name}' to the bucket boundary rather than this column, so it would be permanently unreachable. Rename it.`,
        );
      }
    }

    AnalyticsFolds.assertValid(dataset);
    const declared = new Set([...dimensions, ...measures]);
    // Every column a gauge measure derives, never a sum-only measure's own.
    const derived = AnalyticsFolds.columns(dataset).flatMap((column) =>
      column.name === column.measure
        ? []
        : column.fold === "last"
          ? [column.name, AnalyticsFolds.lastAt(column.measure)]
          : [column.name],
    );
    for (const name of derived) {
      if (declared.has(name)) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares '${name}', which is also a column derived from a gauge measure's folds. Rename it.`,
        );
      }
      if (name === AnalyticsEntityFactory.TIME_COLUMN) {
        throw new AlephaError(
          `Dataset '${dataset.name}' derives the column '${name}' from a gauge measure, which is reserved for the time bucket. Rename the measure.`,
        );
      }
    }

    const overlap = dimensions.filter((name) => measures.includes(name));
    if (overlap.length > 0) {
      throw new AlephaError(
        `Dataset '${dataset.name}' declares ${overlap.map((n) => `'${n}'`).join(", ")} as both a dimension and a measure. One would silently overwrite the other.`,
      );
    }

    if (!/^[a-z][a-z0-9_]*$/.test(dataset.name)) {
      throw new AlephaError(
        `Dataset name '${dataset.name}' is not a legal table-name fragment. Use lowercase letters, digits and underscores, starting with a letter — it is interpolated into 'analytics_<name>_raw'.`,
      );
    }
  }
}
