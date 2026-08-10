import { type Infer, z } from "alepha";

/**
 * One app's (or one project's) analytics over a 1d / 7d / 30d window.
 *
 * ⚠️ `totalViews` is best-effort by construction. Nothing throttles what an
 * enrolled app reports, so the raw count is inflatable by whoever holds a sigil
 * token. `uniqueVisitors` is the trustworthy headline, and the UI labels the
 * two accordingly.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: `currentSigilInsightsAtom` validates against this schema on every write,
 * and importing it from `InsightsController.ts` would pull the repositories and
 * the database provider into the client bundle.
 */
export const insightsResourceSchema = z.object({
  range: z.enum(["1d", "7d", "30d"]),
  /** First UTC day included in the window, `YYYY-MM-DD`. */
  since: z.string(),
  /** Best-effort raw pageview count. Inflatable — see above. */
  totalViews: z.integer(),
  /** Abuse-resistant headline: distinct cookieless daily visitor hashes. */
  uniqueVisitors: z.integer(),
  topCountries: z.array(
    z.object({
      /** ISO-3166 alpha-2, or `ZZ` when the edge did not say. */
      country: z.string(),
      count: z.integer(),
    }),
  ),
  topPaths: z.array(
    z.object({
      path: z.string(),
      count: z.integer(),
      /** Share of `totalViews`, rounded to a whole percent. */
      percentage: z.number(),
    }),
  ),
  /**
   * Web-vitals p75 approximations across every sigil in scope.
   *
   * Derived from the stored histograms, so the cost does not grow with traffic.
   * `null` means no sample landed in the window. CLS is reported as the real
   * score — the collector scales it ×1000 before bucketing, and that scaling is
   * undone in the controller rather than left for the UI to remember.
   */
  vitals: z.object({
    /** Largest Contentful Paint p75, ms. */
    lcp: z.number().nullable(),
    /** Cumulative Layout Shift p75, unitless. */
    cls: z.number().nullable(),
    /** Interaction to Next Paint p75, ms. */
    inp: z.number().nullable(),
    /** First Contentful Paint p75, ms. */
    fcp: z.number().nullable(),
    /** Time to First Byte p75, ms. */
    ttfb: z.number().nullable(),
  }),
  timeline: z.array(
    z.object({
      /** UTC day, `YYYY-MM-DD`. */
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
      /** Occurrences in this app, summed across every batch. */
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
