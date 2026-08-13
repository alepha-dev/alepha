import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";
import { db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Lore's two portable analytics datasets.
 *
 * Views and vitals only. Unique visitors stay in `sigilUniquesDaily` because a
 * distinct count cannot survive sampling or a rollup, and error groups stay in
 * `sigilErrorGroups` because they keep the *first* stack sample, which needs a
 * read before every write.
 *
 * `sigilId` is the index dimension on both: Analytics Engine samples equitably
 * per index value, and per-app is the granularity every Insights read filters
 * on. It is also a real `db.ref` into `sigils`, `onDelete: "cascade"` — the
 * same shape `sigilErrorGroups` uses. Without it, once the legacy aggregate
 * tables are eventually deleted, deleting a sigil would orphan its analytics
 * here forever instead of erasing them, breaking the "rotate, don't delete"
 * guidance the UI gives operators specifically because the legacy tables
 * cascade. `db.ref` mutates the zod schema in place (`pgAttr`), so this
 * metadata survives `AnalyticsEntityFactory`'s spread into `$entity` — the
 * relational backend gets a real foreign key, and Memory / Analytics Engine
 * are unaffected since both only ever read `Object.keys(dimensions.shape)`.
 *
 * `SigilIngestService` writes views and vitals here exclusively —
 * `sigilViewsHourly` / `sigilVitalsHourly` used to receive the same rows
 * through a dual-write while `InsightsController` still read from them, but
 * both the read and the dual-write retired once Insights moved onto these
 * datasets. The two legacy tables stay declared only so
 * `yarn check:migrations` keeps agreeing with what is still physically on
 * disk; nothing in the app reads or writes them anymore.
 */
export class LoreAnalytics {
  public readonly views = $analytics({
    name: "sigil_views",
    index: "sigilId",
    dimensions: z.object({
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
        onDelete: "cascade",
      }),
      path: z.string(),
      country: z.string(),
    }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * Web vitals as a histogram.
   *
   * `bucket` is an ordinary dimension rather than anything special: a
   * percentile cannot be merged across buckets but a histogram can, so the
   * bucket index is a grouping key and the count is the measure.
   */
  public readonly vitals = $analytics({
    name: "sigil_vitals",
    index: "sigilId",
    dimensions: z.object({
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
        onDelete: "cascade",
      }),
      metric: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
