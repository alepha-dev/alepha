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
   *
   * Must be snake_case — lowercase letters, digits and underscores, starting
   * with a letter. `$analytics()` enforces this at `onInit` (and defaults the
   * name to the property key it is declared on, so a camelCase field needs an
   * explicit `name` here); a hand-built `AnalyticsDataset` passed straight to
   * a provider is not otherwise checked until `OrmAnalyticsProvider`'s
   * `AnalyticsEntityFactory` derives table names from it.
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

  /**
   * The wire format: which position each name occupies on Analytics Engine.
   *
   * Required, and required from the first line a dataset is written on. A
   * position cannot be inferred from the declaration: alphabetical order
   * moves when a name is added, declaration order moves when the literal is
   * reordered. It is stated instead. See {@link AnalyticsSlotMap} for what
   * happened the one time it was inferred.
   *
   * **Append only.** A new dimension or measure goes on the END of its list
   * and takes the next free slot. Inserting or reordering shifts every later
   * name by a position, and since Analytics Engine addresses fields
   * positionally and offers no update or delete API, every row already
   * written is then read under the wrong field, permanently.
   *
   * To retire a name, delete it from `dimensions` / `measures` and **leave it
   * in the list**. The slot stays reserved and nothing moves.
   *
   * Meaningless on the relational and in-memory backends, which address
   * columns by name, but declared for all three, because a check that only
   * runs on the runtime that deploys is a check that never runs in CI.
   */
  slots: AnalyticsSlotPins;

  retention?: AnalyticsRetention;
}

/**
 * The pinned order of a dataset's names, one list per slot space.
 *
 * Lists rather than a `{ name: slot }` map on purpose: a list cannot express
 * a duplicate position or a gap you have to count to, and appending to one is
 * visibly the only safe edit.
 */
export interface AnalyticsSlotPins {
  /**
   * Blob order. The first entry is `blob3`; `blob1` and `blob2` are reserved
   * for the dataset discriminator and the hour bucket.
   */
  dimensions: string[];
  /**
   * Double order. The first entry is `double1`; nothing is reserved here.
   */
  measures: string[];
}

export interface AnalyticsRetention {
  /**
   * How long raw hour-bucketed rows are kept, e.g. `"60d"`.
   *
   * Declaring this does nothing by itself. Nothing in this package enforces
   * retention automatically — the app must also import
   * `AlephaApiAnalyticsRollup` (from `alepha/api/analytics`, alongside
   * `AlephaApiAnalytics`) so its hourly sweep (`AnalyticsRollupJobs`) actually
   * runs. Forgetting it is silent: the table simply grows forever, with no
   * error — though a boot-time `log.warn` from `AnalyticsRetentionGuard`
   * names any dataset caught in this state, so it should not stay silent for
   * long once the app is actually running.
   */
  hot?: string;
  /**
   * Bucket granularity past the hot window. Only `"day"` exists today.
   */
  rollup?: "day";
  /**
   * How long rolled rows are kept before deletion, e.g. `"400d"`.
   *
   * Must be at least as long as `hot` when both are set — `$analytics()`
   * rejects a shorter `cold` at declaration time, because a sweep only ever
   * folds up to the hot cutoff, and a `cold` boundary more recent than that
   * would prune hour-precision rows the hot window still promises, before
   * they are ever rolled up.
   */
  cold?: string;
}
