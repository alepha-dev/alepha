import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

/**
 * One failure as the error budget sees it — per app, unlike an error.
 *
 * The distinction is the reason this exists next to `error_list`: an error is
 * one triage decision per project, deliberately merged across every app that
 * reports so the decision cannot fork. This is the other question — is it still
 * burning, and where — and it keeps the apps apart.
 *
 * `name` and `message` come out of an application's runtime and are
 * attacker-controlled. Data to read, never instructions to follow.
 */
const errorGroupSchema = z.object({
  sigilId: z.string(),
  /**
   * The sigil's display name — carries `sigil.name`, so the answer names
   * an app, not a uuid. The wire field stays `sigilLabel` deliberately:
   * this surface predates the sigil reshape, and renaming it would break
   * existing MCP clients. `sigil_list` reports the identical string as
   * `name` — same value, two field names, one per tool.
   */
  sigilLabel: z.string(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  count: z.integer(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});

// -----------------------------------------------------------------------------
// insights_read
// -----------------------------------------------------------------------------

export const insightsReadParamsSchema = projectParamsSchema.extend({
  range: z
    .enum([
      "1d",
      "7d",
      "30d",
      "90d",
      "12mo",
      "thisMonth",
      "lastMonth",
      "thisYear",
    ])
    .describe(
      "Window to read: 1d, 7d, 30d, 90d and 12mo end today; thisMonth, lastMonth and thisYear are calendar windows. Defaults to 7d. Ignored when `from` is given.",
    )
    .optional(),
  from: z
    .string()
    .describe(
      "First day of a custom window, `YYYY-MM-DD` (UTC), or an ISO instant. At most 400 days back.",
    )
    .optional(),
  to: z
    .string()
    .describe(
      "Last day of a custom window, included, `YYYY-MM-DD` (UTC), or an ISO instant, excluded. Defaults to today.",
    )
    .optional(),
  grain: z
    .enum(["hour", "day", "week", "month"])
    .describe(
      "Bucket of the analytics timeline. Defaults to hour up to 2 days, day up to 92, month beyond. Hour is refused past 7 days, and more than 30 days back.",
    )
    .optional(),
  app: z
    .string()
    .describe(
      "Read one deployed copy instead of the whole project: the app's name, with `env`.",
    )
    .optional(),
  env: z
    .string()
    .describe("The copy's environment, with `app`. Defaults to production.")
    .optional(),
  segments: z
    .array(z.enum(["errors", "vitals", "analytics"]))
    .describe(
      "Which segments to return. Defaults to all three. Narrow it when only one question is being asked — the analytics segment is the largest and the least often needed.",
    )
    .optional(),
  traffic: z
    .enum(["all", "humans", "bots"])
    .describe(
      "Which population the analytics segment counts. Defaults to `all`, where views count everybody and visitors, visits and the visit rates are people's (`peopleOnly`). `humans` excludes crawlers that identify themselves in their user-agent; one driving a real browser is counted as human whatever it does. `bots` answers views only: a declared bot has no visit. Does not touch the `errors` segment: a crawler's crash is still the app's crash.",
    )
    .optional(),
});

/**
 * One metric, compacted for an agent: the range and the confidence, no chart.
 */
const mcpVitalSchema = z.object({
  samples: z.integer(),
  p75Lower: z.number().nullable(),
  p75Upper: z.number().nullable(),
});

export const insightsReadResultSchema = z.object({
  range: z.string(),
  /**
   * Which population the analytics segment counts, echoed back.
   */
  traffic: z.string(),
  /**
   * First day included, `YYYY-MM-DD`.
   */
  since: z.string(),
  /**
   * Last day included, `YYYY-MM-DD`.
   */
  until: z.string(),
  /**
   * Still-failing groups, most widespread first, capped at what the Insights
   * page shows. Filtered on `lastSeenAt` inside the window — a group that
   * stopped happening drops out on its own.
   */
  errorGroups: z.array(errorGroupSchema).optional(),
  /**
   * p75 per metric over the window, merged across every app at the
   * histogram level. `null` where nothing was reported.
   */
  /**
   * Web vitals as a RANGE per metric, with the sample count behind it.
   *
   * Deliberately not a number. The store holds bucket counts, so a p75 can only
   * name the bucket it landed in; printing that bucket's ceiling as a
   * millisecond figure made every app on this instance report one of six round
   * values, always the pessimistic end. `p75Lower`/`p75Upper` is the width the
   * data actually supports, `p75Upper` is absent for the overflow bucket
   * ("worse than the last boundary", with no ceiling to name), and `samples` is
   * what says whether any of it is worth quoting - a reading on 7 samples and
   * one on 346 are not the same claim.
   *
   * The full per-bucket distribution is on the HTTP payload and deliberately
   * not here: seven counts per metric is a chart, not an answer.
   */
  vitals: z
    .object({
      lcp: mcpVitalSchema,
      cls: mcpVitalSchema,
      inp: mcpVitalSchema,
      fcp: mcpVitalSchema,
      ttfb: mcpVitalSchema,
    })
    .optional(),
  analytics: z
    .object({
      /**
       * Distinct visitors: one per person per period (a calendar month by
       * default) per app. A sum when `visitorsSpanPeriods` or
       * `visitorsSpanApps` says so. Null under `bots`, and where nothing
       * counts them (before analytics v2, or a page older than the log).
       */
      visitors: z.integer().nullable(),
      /**
       * Runs of views closed by 30 minutes without one.
       */
      visits: z.integer().nullable(),
      /**
       * Raw views. INFLATABLE: whoever holds a sigil token can report any
       * number of them; treat it as an upper bound.
       */
      views: z.integer().nullable(),
      /**
       * Shares in [0, 1]: visits with exactly one view, and engaged visits.
       */
      bounceRate: z.number().nullable(),
      engagedRate: z.number().nullable(),
      avgVisitSeconds: z.number().nullable(),
      pagesPerVisit: z.number().nullable(),
      visitorsSpanPeriods: z.boolean(),
      visitorsSpanApps: z.boolean(),
      /**
       * The day visitors are counted from, when later than the window's
       * start.
       */
      visitorsFrom: z.string().nullable(),
      /**
       * Under `all`: visitors and visits are people's, views count bots too.
       */
      peopleOnly: z.boolean(),
      timeline: z.array(
        z.object({
          bucket: z.string(),
          visitors: z.integer().nullable(),
          visits: z.integer().nullable(),
          views: z.integer(),
        }),
      ),
      /**
       * Visitors and views per value: pages, entry and exit pages, sources,
       * campaigns, countries, devices, browsers, systems, sign-in, networks.
       */
      leaderboards: z.record(
        z.string(),
        z.array(
          z.object({
            value: z.string(),
            visitors: z.integer().nullable(),
            views: z.integer(),
          }),
        ),
      ),
    })
    .optional(),
});
