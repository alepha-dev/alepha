import { type Infer, z } from "alepha";

import { trafficFilterSchema } from "./trafficFilterSchema.ts";
import { vitalsMetricSchema } from "./vitalsMetricSchema.ts";

/**
 * One app's (or one project's) analytics over a 1d / 7d / 30d window.
 *
 * ⚠️ `totalViews` is best-effort by construction. Nothing throttles what an
 * enrolled app reports, so the raw count is inflatable by whoever holds a sigil
 * token. `uniqueVisitors` is the trustworthy headline, and the UI labels the
 * two accordingly.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: `useAppInsights` types the analytics tabs against this schema, and
 * importing it from `InsightsController.ts` would pull the repositories and
 * the database provider into the client bundle.
 */
export const insightsResourceSchema = z.object({
  range: z.enum(["1d", "7d", "30d"]),
  /**
   * Which population these numbers describe, echoed back from the request.
   *
   * Here for the same reason `range` is: the page renders from the payload,
   * not from the control that produced it, so the control can be restored
   * from a response the page did not itself ask for. `all` when the caller
   * asked for nothing, so a reader never has to treat absence as a third
   * state.
   */
  traffic: trafficFilterSchema,
  /**
   * First UTC day included in the window, `YYYY-MM-DD`.
   */
  since: z.string(),
  /**
   * Last UTC day included, `YYYY-MM-DD`.
   *
   * Normally today, and then the window ends **mid-day**: `range: "1d"` means
   * today-so-far, not yesterday. That distinction is invisible until you
   * compare two windows, at which point a partial day measured against a
   * complete one reads as a collapse every morning and recovers by dinner.
   * `until: "lastCompleteDay"` on the request is what moves this to yesterday
   * and makes a delta a statement about traffic.
   */
  until: z.string(),
  /**
   * The window of the same width immediately before this one, present only
   * when the caller asked to compare.
   *
   * Measured the same way, in the same request, so the delta is not two
   * numbers a client fetched separately and subtracted.
   */
  previous: z
    .object({
      since: z.string(),
      until: z.string(),
      /**
       * The trustworthy half of the comparison. Always exact.
       */
      uniqueVisitors: z.integer(),
      /**
       * Best-effort, like its current-window counterpart.
       */
      totalViews: z.integer(),
    })
    .optional(),
  /**
   * Change in `uniqueVisitors` against `previous`, whole percent.
   *
   * Absent when there is nothing honest to say: no comparison was asked for,
   * or the previous window was zero, where a percentage is undefined rather
   * than infinite. A UI must render the absence as "no comparison", never as
   * `+0%`.
   *
   * On uniques and not on `totalViews` deliberately — see the note at the top
   * of this file. A delta amplifies whatever noise is in both windows, so it
   * belongs on the number that cannot be inflated.
   */
  uniqueVisitorsDelta: z.number().optional(),
  /**
   * Best-effort raw pageview count. Inflatable — see above.
   */
  totalViews: z.integer(),
  /**
   * Abuse-resistant headline: distinct cookieless daily visitor hashes.
   */
  uniqueVisitors: z.integer(),
  /**
   * Filters this request carried that `uniqueVisitors` could NOT honour.
   *
   * Empty on almost every request, and then the count describes exactly the
   * same slice as every other number here. Non-empty means the count is
   * WIDER than the rest of the payload, and names by how much.
   *
   * It exists because the two numbers come from different stores.
   * `totalViews` and the leaderboards are read from the `sigil_views`
   * dataset, which carries every dimension; `uniqueVisitors` is read from
   * `sigil_uniques_daily`, which is keyed `(sigilId, day, visitorHash)` and
   * carries `traffic` and nothing else. Narrowing it by a further dimension
   * is possible - `traffic` was added to that exact table in 2026-08, joined
   * its unique index, and `SigilJobs.collapseUniques` folds per
   * `(sigilId, traffic)` - but it is paid for in rows and sentinel rows per
   * distinct value, which is a very different bill for `country` (~200
   * values) or `path` (unbounded) than it was for `traffic` (two).
   *
   * So the cost is not paid, and the honesty is put here instead: a reader
   * that ignores this field would show a project-wide visitor count beside
   * filtered views with nothing on screen saying so. A UI should label the
   * tile or hide it. This list is derived from what the uniques table can
   * narrow by, so a dimension added there later drops out of it on its own.
   */
  uniqueVisitorsIgnores: z.array(z.string()),
  topCountries: z.array(
    z.object({
      /**
       * ISO-3166 alpha-2, or `ZZ` when the edge did not say.
       */
      country: z.string(),
      count: z.integer(),
    }),
  ),
  topPaths: z.array(
    z.object({
      path: z.string(),
      count: z.integer(),
      /**
       * Share of `totalViews`, rounded to a whole percent.
       */
      percentage: z.number(),
    }),
  ),
  /**
   * Where visits came from, by host.
   *
   * `direct` is the catch-all bucket, and it will normally be the largest one
   * by a wide margin: only a page load's own view carries a referrer at all,
   * so every client-side navigation lands here alongside genuine bookmark and
   * typed-URL arrivals. Read the *other* rows; `direct` is a denominator, not
   * a traffic source.
   */
  /**
   * Page loads, as opposed to `totalViews` which also counts every
   * client-side navigation. This is the denominator for a bounce rate and the
   * number a landing-page report is a breakdown of.
   */
  entries: z.integer(),
  /**
   * Views the visitor scrolled, clicked, typed on, or stayed ten seconds on.
   *
   * The one number here that a scraper cannot inflate by accident: an
   * automated fetch renders the page, reports the view, and never does any of
   * those things. Compare it against `totalViews` before believing a traffic
   * spike is people.
   */
  engagedViews: z.integer(),
  /**
   * `engagedViews / totalViews`, rounded to a whole percent.
   */
  engagementRate: z.number(),
  /**
   * Where visits *started*, by `entries` rather than by total views.
   */
  topEntryPaths: z.array(
    z.object({
      path: z.string(),
      count: z.integer(),
      percentage: z.number(),
    }),
  ),
  /**
   * `utm_campaign` / `utm_source` tags on arrivals. `none` is untagged.
   */
  topCampaigns: z.array(
    z.object({
      campaign: z.string(),
      count: z.integer(),
    }),
  ),
  /**
   * `mobile` / `tablet` / `desktop`, by total views.
   */
  topDevices: z.array(
    z.object({
      device: z.string(),
      count: z.integer(),
    }),
  ),
  topReferrers: z.array(
    z.object({
      /**
       * A bare host (`news.ycombinator.com`), or `direct`.
       */
      referrer: z.string(),
      count: z.integer(),
      /**
       * Share of `totalViews`, rounded to a whole percent.
       */
      percentage: z.number(),
    }),
  ),
  /**
   * Web-vitals distributions across every sigil in scope.
   *
   * Derived from the stored histograms, so the cost does not grow with traffic,
   * which is also why each metric is a distribution and a p75 BUCKET rather
   * than a p75 value. See {@link vitalsMetricSchema} for what printing the
   * bucket's ceiling as a millisecond figure did to this page.
   *
   * Every metric is always present, with `samples: 0` where the window saw
   * nothing. Absent and empty are different claims, and only the second lets a
   * UI say "no interaction samples yet" for INP instead of rendering a blank.
   */
  vitals: z.object({
    /**
     * Largest Contentful Paint, ms.
     */
    lcp: vitalsMetricSchema,
    /**
     * Cumulative Layout Shift, unitless.
     */
    cls: vitalsMetricSchema,
    /**
     * Interaction to Next Paint, ms.
     */
    inp: vitalsMetricSchema,
    /**
     * First Contentful Paint, ms.
     */
    fcp: vitalsMetricSchema,
    /**
     * Time to First Byte, ms.
     */
    ttfb: vitalsMetricSchema,
  }),
  timeline: z.array(
    z.object({
      /**
       * UTC day, `YYYY-MM-DD`.
       */
      date: z.string(),
      views: z.integer(),
    }),
  ),
  /**
   * The per-app error budget: one row per `(sigil, fingerprint)` still seen
   * inside the window, worst first.
   *
   * This is the question `sigil_error_groups` exists to answer and the Blights
   * inbox structurally cannot — the inbox folds every sigil into one row per
   * project, because a triage decision must not fork, which is exactly what
   * makes it useless for "is this still happening *in that app*".
   *
   * ⚠️ `name` and `message` come out of an application's runtime and are
   * attacker-controlled. Escaped plain text only, never markdown.
   */
  errorGroups: z.array(
    z.object({
      sigilId: z.uuid(),
      /**
       * The sigil's display name, so the UI needs no second lookup. The wire
       * field keeps the `sigilLabel` name that MCP clients already read.
       */
      sigilLabel: z.string(),
      fingerprint: z.string(),
      name: z.string(),
      message: z.string(),
      /**
       * Occurrences in this app, summed across every batch.
       */
      count: z.integer(),
      firstSeenAt: z.string(),
      lastSeenAt: z.string(),
    }),
  ),
  /**
   * Whether the view and vitals numbers are reconstructed from a sample.
   *
   * A field on the response, not a note in the docs: the UI renders these in
   * the typography of measurement, and the only thing that stops it doing so
   * wrongly is this value reaching it. Unique visitors are always exact and are
   * unaffected.
   */
  estimated: z.boolean(),
  /**
   * Largest sample interval behind these numbers. `1` means nothing was
   * sampled and the numbers are exact despite `estimated` being true.
   */
  sampleInterval: z.number().optional(),
});

export type InsightsResource = Infer<typeof insightsResourceSchema>;
