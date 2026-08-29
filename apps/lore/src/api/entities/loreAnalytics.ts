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
       * **Adding this dimension re-slotted the Analytics Engine wire format,
       * once, and it cost eight days of history.** Slots used to derive from
       * alphabetically sorted dimension names, so `referrer` landed between
       * `path` and `sigilId` and pushed `sigilId` along. Rows written before
       * that change carry a sigil id in a slot now read as a referrer, so they
       * match no `WHERE sigilId IN (…)` and are absent from every Insights
       * read, permanently, since Analytics Engine has no update or delete
       * API. Slots are pinned below now and this cannot recur; the pin is
       * what made the name a free choice again.
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
      /**
       * `bot` | `human`, classified by the app's own proxy from the
       * user-agent it already holds. See `sigilTrafficKind` for what that
       * claim is worth: it catches a crawler that announces itself, and the
       * largest automated population on this project's own docs app announces
       * nothing at all. `human` therefore means "did not declare itself a
       * bot", and `engaged` remains the honest discriminator for the rest.
       *
       * **The name used to be load-bearing, and is not any more.** While
       * slots derived from alphabetically sorted names, a new dimension only
       * avoided re-slotting the wire format if it sorted LAST: `traffic`
       * sorts after `sigilId`, so it took the free slot and left every stored
       * row where it was, while `bot`, `kind`, `agent` or `class` would each
       * have misread every view ever recorded. Slots are pinned below now, so
       * the next dimension can be called whatever it should be called. The
       * name stays because it is the right one, not because of where it
       * sorts.
       *
       * Rows written before this dimension existed hold `""` here rather than
       * the default - a default applies when a row is written, not when an old
       * one is read. That is why the humans filter matches a SET rather than
       * one value; see `InsightsController.HUMAN_TRAFFIC`.
       *
       * The default is not decoration either, and it is the same trap
       * `referrer` and `engaged` both hit: on the relational backend this is
       * `ALTER TABLE ... ADD traffic text NOT NULL`, which SQLite refuses
       * outright on a table that already holds rows unless the column carries
       * a non-null default.
       */
      traffic: z.string().default("human"),
    }),
    /**
     * Three measures, and the two new ones cost nothing on the wire.
     *
     * Measure slots were derived alphabetically the same way dimension slots
     * were, but `count` sorts before both `engaged` and `entries`, so it kept
     * `double1` and no stored row was misread. That was luck, not a property
     * of measures; both spaces are pinned below now, and both are append-only
     * for the same reason.
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
    /**
     * The wire format, and the reason the two comments above talk about
     * `blob8` and about `traffic` having to sort last.
     *
     * These positions are exactly the ones alphabetical derivation produced
     * on 2026-08-26, so pinning them moves nothing: every row Analytics
     * Engine already holds under the current layout stays readable. What
     * changes is the future - the next dimension goes on the END of this
     * list and pushes nothing, whatever it is called.
     *
     * ⚠️ Rows written between 2026-08-10 and 2026-08-18 carry the
     * pre-`referrer` layout (`sigilId` in `blob5`, then `blob7`) and are
     * **knowingly unreadable**. They match no `WHERE sigilId IN (…)` and so
     * count as absent. Analytics Engine has no update or delete API, so
     * there is nothing to repair them with; they leave the widest window
     * this dataset offers (30d) on 2026-09-17 and the gap closes itself. Do
     * not add a second read path for them: the values are recoverable only
     * by guessing which generation a row belongs to from which trailing
     * blobs are empty, and a leaderboard filled from the wrong dimension is
     * worse than a gap.
     */
    slots: {
      dimensions: [
        "campaign",
        "country",
        "device",
        "path",
        "referrer",
        "sigilId",
        "traffic",
      ],
      measures: ["count", "engaged", "entries"],
    },
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
    /**
     * Pinned at the positions alphabetical derivation already gave them, so
     * every stored row stays readable. Append only - see `views` above and
     * `AnalyticsSlotMap`.
     */
    slots: {
      dimensions: ["bucket", "metric", "path", "sigilId"],
      measures: ["samples"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
