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
      /**
       * The cross-origin host the visit came from, or `direct`.
       *
       * Only a page load's own view carries one — a client-side navigation
       * inherits `document.referrer` unchanged, so counting it again would
       * turn one arrival into a whole session. `SigilIngestService` folds
       * everything else (no referrer, same-origin, a stripped
       * `referrer-policy`, a view that is not the landing one) into `direct`,
       * because none of those can be told apart from the sink and pretending
       * otherwise would invent precision.
       *
       * **Adding this dimension re-slotted the Analytics Engine wire format.**
       * Slots derive from alphabetically sorted dimension names, so
       * `referrer` landed between `path` and `sigilId` and pushed `sigilId`
       * from `blob5` to `blob6` — see `AnalyticsSlotMap`'s class doc, which
       * says outright that changing the derivation misreads history rather
       * than failing. Rows written before this change carry a sigil id in the
       * slot now read as a referrer, so they no longer match any
       * `WHERE sigilId IN (…)` and drop out of every Insights read. That was
       * accepted deliberately: the alternative was naming the dimension for
       * where it sorts rather than for what it holds, which buys eight days of
       * bot traffic at the price of a name nobody could later explain.
       *
       * The default is not decoration. On the relational backend this is
       * `ALTER TABLE … ADD referrer text NOT NULL`, and SQLite refuses that
       * outright on a table that already has rows unless the column carries a
       * non-null default — so without it the migration is one that generates
       * cleanly, passes `check:migrations`, and then fails on the first
       * deployment that has ever recorded a view.
       */
      referrer: z.string().default("direct"),
      /**
       * `utm_campaign` (else `utm_source`) from the landing URL, or `none`.
       *
       * Only an arrival can carry one, so every non-landing view is `none` —
       * which is why the campaign leaderboard sums `entries` rather than
       * `count`. Without this the tag is simply lost: `normalizePath` splits
       * on `?`, deliberately, so a link posted with `?utm_source=hn` is today
       * indistinguishable from an untagged one.
       */
      campaign: z.string().default("none"),
      /**
       * `mobile` | `tablet` | `desktop`, classified by the app's own proxy
       * from the user-agent it already holds. Three buckets on purpose — see
       * `sigilDeviceClass` for why a real UA parser would cost precision
       * everywhere else on this dataset.
       */
      device: z.string().default("desktop"),
    }),
    /**
     * Three measures, and the two new ones cost nothing on the wire.
     *
     * Measure slots derive from alphabetically sorted names the same way
     * dimension slots do, but `count` sorts before both `engaged` and
     * `entries` — so it keeps `double1` and no stored row is misread. That
     * asymmetry is worth knowing: a fact expressible as a measure is nearly
     * free to add later, while a dimension almost never is.
     *
     * `engaged` arrives on its own row with `count: 0`, because Analytics
     * Engine is append-only and engagement is not knowable when the view is
     * recorded. Summing the two independently is what makes that work.
     */
    measures: z.object({
      count: z.number(),
      /**
       * Defaulted for the same reason the new dimensions are, and it is the
       * same trap: on the relational backend this is
       * `ALTER TABLE … ADD engaged real NOT NULL`, which SQLite rejects
       * outright on a table that already holds rows. Zero is also the right
       * value for every row written before engagement existed — none of them
       * measured any.
       */
      engaged: z.number().default(0),
      entries: z.number().default(0),
    }),
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
