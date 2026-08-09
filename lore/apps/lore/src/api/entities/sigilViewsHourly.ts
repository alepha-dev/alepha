import type { Infer } from "alepha";
import { sigilAnalytics } from "./sigilAnalytics.ts";

/**
 * Page views, rolled up on write — one row per `(sigilId, hour, path,
 * country)`.
 *
 * Declared by `@alepha/sigil/ingest`'s entity factory; see
 * `sigilAnalytics.ts` for why the schema lives in the package while the
 * foreign key into `sigils` stays here. This module is the name every call
 * site already imports.
 */
export const sigilViewsHourly = sigilAnalytics.views;

export type SigilViewHourly = Infer<typeof sigilViewsHourly.schema>;
export type SigilViewHourlyInsert = Infer<typeof sigilViewsHourly.insertSchema>;
