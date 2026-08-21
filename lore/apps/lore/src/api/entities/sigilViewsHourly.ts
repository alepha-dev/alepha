import type { Infer } from "alepha";

import { sigilAnalytics } from "./sigilAnalytics.ts";

/**
 * Page views, rolled up on write — one row per `(sigilId, hour, path,
 * country)`.
 *
 * Declared by `@alepha/sigil/ingest`'s entity factory; see
 * `sigilAnalytics.ts` for why the schema lives in the package while the
 * foreign key into `sigils` stays here.
 *
 * **Frozen.** Nothing reads or writes this table anymore — views moved onto
 * `LoreAnalytics`'s `sigil_views` `$analytics()` dataset. It stays declared
 * so `yarn check:migrations` keeps agreeing with what is still physically on
 * disk; dropping it is a separate, deliberate decision this module does not
 * make on its own.
 */
export const sigilViewsHourly = sigilAnalytics.views;

export type SigilViewHourly = Infer<typeof sigilViewsHourly.schema>;
export type SigilViewHourlyInsert = Infer<typeof sigilViewsHourly.insertSchema>;
