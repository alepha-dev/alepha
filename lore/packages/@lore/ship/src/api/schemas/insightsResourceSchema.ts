import { type Infer, z } from "alepha";

import { insightsGrainSchema } from "./insightsGrainSchema.ts";
import { insightsLeaderboardRowSchema } from "./insightsLeaderboardRowSchema.ts";
import { insightsRangeSchema } from "./insightsRangeSchema.ts";
import { insightsTotalsSchema } from "./insightsTotalsSchema.ts";
import { trafficFilterSchema } from "./trafficFilterSchema.ts";
import { vitalsMetricSchema } from "./vitalsMetricSchema.ts";

/**
 * One app's (or one project's) analytics over a window: visitors, visits and
 * views with the visit rates, their timeline and leaderboards, the vitals and
 * the error budget.
 *
 * ⚠️ Views are best-effort by construction: nothing throttles what an
 * enrolled app reports, so a raw count is inflatable by whoever holds a sigil
 * token. Visitors are a count of distinct hashes, one per person per period.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: importing it from `InsightsController.ts` would pull the repositories
 * and the database provider into the client bundle.
 */

/**
 * The response of `InsightsController.getInsights`.
 */
export const insightsResourceSchema = z.object({
  range: z.union([insightsRangeSchema, z.literal("custom")]),
  traffic: trafficFilterSchema,
  /**
   * `[from, to)`, ISO 8601 UTC instants.
   */
  from: z.string(),
  to: z.string(),
  grain: insightsGrainSchema,
  /**
   * The same window as whole UTC days, inclusive: what vitals and the error
   * budget are read over.
   */
  since: z.string(),
  until: z.string(),
  totals: insightsTotalsSchema,
  /**
   * The window of the same length just before, when `compare` was asked.
   */
  previous: z
    .object({
      from: z.string(),
      to: z.string(),
      totals: insightsTotalsSchema,
    })
    .optional(),
  timeline: z.array(
    z.object({
      bucket: z.string(),
      visitors: z.integer().nullable(),
      visits: z.integer().nullable(),
      views: z.integer(),
    }),
  ),
  /**
   * The visitor count adds up several periods of one app.
   */
  visitorsSpanPeriods: z.boolean(),
  /**
   * The visitor count adds up several apps.
   */
  visitorsSpanApps: z.boolean(),
  /**
   * The day visitors are counted from, when later than the window's start.
   */
  visitorsFrom: z.string().nullable(),
  /**
   * Visitors, visits and the visit rates are the people's, while views count
   * declared bots too (`traffic: all`).
   */
  peopleOnly: z.boolean(),
  leaderboards: z.object({
    path: z.array(insightsLeaderboardRowSchema),
    entry: z.array(insightsLeaderboardRowSchema),
    exit: z.array(insightsLeaderboardRowSchema),
    referrer: z.array(insightsLeaderboardRowSchema),
    campaign: z.array(insightsLeaderboardRowSchema),
    country: z.array(insightsLeaderboardRowSchema),
    device: z.array(insightsLeaderboardRowSchema),
    browser: z.array(insightsLeaderboardRowSchema),
    os: z.array(insightsLeaderboardRowSchema),
    auth: z.array(insightsLeaderboardRowSchema),
    network: z.array(insightsLeaderboardRowSchema),
  }),
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
  /**
   * The per-app error budget: one row per `(sigil, fingerprint)` still seen
   * inside the window, worst first.
   *
   * This is the question `sigil_error_groups` exists to answer and the Errors
   * inbox structurally cannot — the inbox folds every sigil into one row per
   * project, because a triage decision must not fork, which is exactly what
   * makes it useless for "is this still happening *in that app*".
   *
   * ⚠️ `name` and `message` come out of an application's runtime and are
   * attacker-controlled. Escaped plain text only, never markdown.
   */
  errorGroups: z.array(
    z.object({
      /**
       * The project's error this group belongs to (`project_errors.id`), so
       * the row can open its page. Absent once that error was deleted or
       * purged: the group outlives it.
       */
      errorId: z.integer().optional(),
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
       * Where the failure was raised: `client` in a browser, `server` in the
       * app's own process.
       *
       * It has been on the row since the table existed and was simply never
       * mapped onto the wire (feedback #2085 asked for the split and it cost
       * a schema field and one line of the read path). Written by the
       * reporting app, so it is a claim like every other field here - but a
       * closed two-value one, unlike `name` and `message`.
       */
      origin: z.enum(["client", "server", "run"]),
      /**
       * Occurrences in this app, summed across every batch.
       *
       * ⚠️ ALL-TIME, not the window's. The read filters on `lastSeenAt` and
       * this column is a running total, so a group last seen inside the
       * window reports every occurrence it has ever had. The UI labels it as
       * such; `errorSeries` is the number that respects the window.
       */
      count: z.integer(),
      firstSeenAt: z.string(),
      lastSeenAt: z.string(),
    }),
  ),
  /**
   * Error occurrences per day over the window, split by origin.
   *
   * ⚠️ This, and NOT `errorGroups[].count`, is the number a chart may plot.
   * `errorGroups` carries each group's all-time total and is filtered on
   * `lastSeenAt`, so summing it would draw lifetime figures against a window.
   *
   * Every day in the window is present, zeroed where nothing was recorded,
   * the same shape as `timeline` - a chart must not draw a gap as a dip.
   *
   * Empty for a window that predates the `sigil_errors` dataset: it is
   * append-only, and nothing backfills it from the aggregate table (there is
   * nothing to backfill FROM - individual occurrences were never stored).
   */
  errorSeries: z.array(
    z.object({
      date: z.string(),
      client: z.integer(),
      server: z.integer(),
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
