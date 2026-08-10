import type { Infer } from "alepha";
import { sigilAnalytics } from "./sigilAnalytics.ts";

export {
  VITALS_BUCKET_COUNT,
  type VitalsBucketColumn,
  vitalsBucketColumn,
} from "@alepha/sigil/ingest";

/**
 * Web-vitals samples, kept as bucket counts rather than values — seven integer
 * columns, one per bucket index, so a whole batch increments in one statement.
 *
 * Declared by `@alepha/sigil/ingest`'s entity factory; see `sigilAnalytics.ts`
 * for why the schema lives in the package while the foreign key into `sigils`
 * stays here.
 *
 * **Frozen.** Nothing reads or writes this table anymore — vitals moved onto
 * `LoreAnalytics`'s `sigil_vitals` `$analytics()` dataset, one row per
 * `(hour, sigilId, metric, path, bucket)` rather than one row with seven
 * bucket columns. `VITALS_BUCKET_COUNT` / `vitalsBucketColumn` are
 * re-exported below only because this module is where existing call sites
 * already import them from, not because anything still calls them here.
 */
export const sigilVitalsHourly = sigilAnalytics.vitals;

export type SigilVitalHourly = Infer<typeof sigilVitalsHourly.schema>;
export type SigilVitalHourlyInsert = Infer<
  typeof sigilVitalsHourly.insertSchema
>;
