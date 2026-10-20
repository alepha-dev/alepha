import type { ZObject } from "alepha";

import type { AnalyticsFold } from "./analyticsQuerySchema.ts";

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

  /**
   * The finest bucket: `"1m"`, `"5m"`, `"15m"` or `"1h"` (the default).
   *
   * Sub-hour buckets are keyed `YYYY-MM-DDTHH:MM`, the minute floored to the
   * resolution, and grouped with the `minute` pseudo-dimension. They fold
   * into day buckets like hour buckets do. Analytics Engine refuses anything
   * but `"1h"` at boot.
   */
  resolution?: AnalyticsResolution;

  /**
   * How each measure folds, e.g.
   * `{ temperature: ["min", "max", "last"], validations: ["sum"] }`.
   *
   * An undeclared measure folds `["sum"]` and keeps one column named after
   * itself. A measure with any other fold gets one column per fold,
   * `<measure>_<fold>`, plus `<measure>_last_at` (millis) when it declares
   * `last`; those columns are nullable, since a row may omit a gauge, and
   * every fold treats a missing reading as absent rather than as `0`.
   *
   * Anything but `sum` needs an exact backend: Analytics Engine samples, so
   * a dataset declaring `min`, `max` or `last` is refused at boot there.
   */
  folds?: Record<string, AnalyticsFold[]>;

  /**
   * How long each tier keeps its buckets: either an ordered list of tiers,
   * finest first, or the original `{ hot, rollup, cold }` shape, which is the
   * two-tier list `[{ resolution, keep: hot }, { resolution: "1d", keep: cold }]`.
   *
   * ```ts
   * retention: [
   *   { resolution: "1m", keep: "48h" },
   *   { resolution: "1h", keep: "30d" },
   *   { resolution: "1d", keep: "400d" },
   * ]
   * ```
   *
   * The first tier's resolution is the dataset's `resolution`; each next one
   * is strictly coarser and a multiple of it; each `keep` is a whole number
   * of its tier's buckets, at least one bucket of the next tier, and at least
   * as long as the previous tier's. Only the last tier may omit `keep`
   * (kept forever). The hourly sweep folds each tier's rows older than its
   * `keep` into the next tier, and deletes the last tier's past its `keep`.
   */
  retention?: AnalyticsRetention | AnalyticsTierSpec[];

  /**
   * Buffers writes in memory, pre-folded, and flushes them as one write of
   * distinct keys: on `maxRows` distinct keys, `flushMs` after the first
   * buffered row, and on shutdown. Off by default.
   *
   * A buffered `record()` resolves once the row is **buffered**, not stored:
   * a crash loses at most one buffer per process. Leave it off where a
   * caller needs durability. Ignored on Analytics Engine, whose writes are
   * already fire-and-forget batches. See `AnalyticsBuffer`.
   */
  buffer?: { maxRows: number; flushMs: number };
}

/**
 * One tier of a dataset's retention chain.
 */
export interface AnalyticsTierSpec {
  resolution: AnalyticsTierResolution;
  /**
   * A window such as `"48h"`, `"30d"` or `"90m"`. Omitted on the last tier
   * only: kept forever.
   */
  keep?: string;
}

/**
 * The resolution of a tier: a dataset resolution, or a day.
 */
export type AnalyticsTierResolution = AnalyticsResolution | "1d";

/**
 * The finest bucket a dataset records into.
 */
export type AnalyticsResolution = "1m" | "5m" | "15m" | "1h";

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
