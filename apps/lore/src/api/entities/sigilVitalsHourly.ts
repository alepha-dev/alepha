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
 * stays here. The bucket constants are re-exported because every call site in
 * this app imports them from the entity module.
 */
export const sigilVitalsHourly = sigilAnalytics.vitals;

export type SigilVitalHourly = Infer<typeof sigilVitalsHourly.schema>;
export type SigilVitalHourlyInsert = Infer<
  typeof sigilVitalsHourly.insertSchema
>;
