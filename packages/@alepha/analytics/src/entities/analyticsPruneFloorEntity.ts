import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One row per dataset name: the boundary below which `query()` must never
 * resurface data again, once `prune()` has been asked to remove it.
 *
 * **Why this cannot be a row in the dataset's own raw/rolled table.**
 * `WaeAnalyticsProvider.prune()` only ever deletes from `cold` —
 * Analytics Engine has no delete API — so `cold`'s own current holdings are
 * not enough to answer "has this window already been pruned": a query for
 * a since-pruned window that fell out of `cold` would otherwise fall back to
 * Analytics Engine and silently resurrect data a caller already asked to
 * remove. A sentinel row in the dataset's own table cannot fix this: every
 * declared dimension would need a value, including a foreign-keyed one
 * (Lore's `sigilId: db.ref(z.uuid(), ...)`, say) where no safe placeholder
 * value exists without either violating the constraint or referencing real,
 * unrelated data — and an unfiltered query would silently fold the
 * sentinel's placeholder measures into a real total. A single, separate,
 * package-owned table — the same shape `alepha/api/jobs`'s own
 * `jobExecutionEntity` already uses for its tracking state — has neither
 * problem: it carries nothing but the dataset name and a date string, so it
 * is trivially safe regardless of what any given dataset declares.
 *
 * Registered eagerly — the same as every dataset's own raw/rolled pair, not
 * lazily on first `prune()`, for the same container-locks-after-start
 * reason — but **not** unconditionally alongside every dataset.
 * `OrmAnalyticsProvider.registerPruneFloors()` is a separate call, made only
 * by `WaeAnalyticsProvider.register()`: a plain relational deployment
 * genuinely deletes on `prune()` and has no use for a floor, so it must
 * never carry this table, on pain of a production migration nothing ever
 * reads or writes.
 */
export const analyticsPruneFloorEntity = $entity({
  name: "analytics_prune_floors",
  schema: z.object({
    dataset: db.primaryKey(z.text()),
    floor: z.text(),
  }),
});

export type AnalyticsPruneFloorEntity = Infer<
  typeof analyticsPruneFloorEntity.schema
>;
