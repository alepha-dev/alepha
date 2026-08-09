import type { Infer } from "alepha";
import { sigilAnalytics } from "./sigilAnalytics.ts";

export { UNIQUES_COLLAPSED_HASH } from "@alepha/sigil/ingest";

/**
 * One row per visitor per sigil per day — the cookieless unique count.
 *
 * Declared by `@alepha/sigil/ingest`'s entity factory (read its docstring for
 * the visitor-hash construction and why the daily salt must come from a
 * secret); see `sigilAnalytics.ts` for why the schema lives in the package
 * while the foreign key into `sigils` stays here.
 *
 * `SigilJobs` writes the collapsed rows this table's second shape describes,
 * and `UNIQUES_COLLAPSED_HASH` is re-exported here because every call site in
 * this app imports it from the entity module.
 */
export const sigilUniquesDaily = sigilAnalytics.uniques;

export type SigilUniqueDaily = Infer<typeof sigilUniquesDaily.schema>;
export type SigilUniqueDailyInsert = Infer<
  typeof sigilUniquesDaily.insertSchema
>;
