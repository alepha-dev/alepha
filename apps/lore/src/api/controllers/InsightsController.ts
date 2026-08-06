import { VITALS_BUCKETS, type VitalMetric } from "@alepha/sigil/vitals";
import { $inject, type Infer, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import { sigilUniquesDaily } from "../entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../entities/sigilVitalsHourly.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/** Lookback windows the Insights page offers, in whole UTC days. */
const RANGE_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
};

/** How many rows the top-countries / top-paths leaderboards return. */
const TOP_N = 10;

/**
 * How many error groups the budget section returns.
 *
 * Wider than the leaderboards on purpose: an error budget you have to paginate
 * is one nobody reads to the bottom, and the tail is where a new regression
 * shows up before it is anyone's top ten.
 */
const TOP_ERROR_GROUPS = 20;

/**
 * One project's analytics over a 1d / 7d / 30d window.
 *
 * ⚠️ `totalViews` is best-effort by construction. Nothing throttles what an
 * enrolled app reports, so the raw count is inflatable by whoever holds a sigil
 * token. `uniqueVisitors` is the trustworthy headline, and the UI labels the
 * two accordingly.
 */
const insightsSchema = z.object({
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
   * Web-vitals p75 approximations across every sigil on the project.
   *
   * Derived from the stored histograms, so the cost does not grow with traffic.
   * `null` means no sample landed in the window. CLS is reported as the real
   * score — the collector scales it ×1000 before bucketing, and that scaling is
   * undone here rather than left for the UI to remember.
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
});

export type InsightsResource = Infer<typeof insightsSchema>;

/**
 * The reading surface for what `SigilIngestService` writes.
 *
 * Every row it aggregates is scoped to a sigil, and every sigil to a project,
 * so each query is `WHERE sigil_id IN (the project's sigils)`.
 *
 * **Hour buckets, day answers.** `sigil_views_hourly.hour` is `YYYY-MM-DDTHH`,
 * which shares its first ten characters with a `YYYY-MM-DD` day. That makes the
 * window filter a plain lexicographic `hour >= since` with no epoch math, and
 * the daily timeline a `substr(hour, 1, 10)` group — the day view stays
 * available without giving up the resolution that makes a 14:00 deploy visible
 * against 13:00.
 *
 * **The error budget lives here too.** `sigil_error_groups` is the only table
 * that keeps failures split by app, and "is this still happening over there" is
 * a per-app question the project-wide Blights inbox cannot answer by
 * construction. This is the surface that asks it — the same
 * range selector, the same member gate, no second route for one list.
 *
 * Reads are member-gated: analytics are not an owner secret, and the page is
 * linked from the project nav every member sees.
 */
export class InsightsController {
  protected database = $inject(DatabaseProvider);
  protected security = $inject(ProjectSecurityService);
  protected dateTime = $inject(DateTimeProvider);
  protected sigils = $repository(sigils);
  protected views = $repository(sigilViewsHourly);
  protected uniques = $repository(sigilUniquesDaily);
  protected vitals = $repository(sigilVitalsHourly);
  protected errorGroups = $repository(sigilErrorGroups);

  getInsights = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/insights",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        range: z.enum(["1d", "7d", "30d"]).optional(),
      }),
      response: insightsSchema,
    },
    handler: async ({ params, query, user }): Promise<InsightsResource> => {
      await this.security.assertMember(params.projectId, user);

      const range = query.range ?? "7d";
      const days = RANGE_DAYS[range] ?? 7;

      // A `days`-wide UTC window covering [today-(days-1) .. today].
      const today = new Date(this.dateTime.nowMillis());
      const sinceDate = new Date(today);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      const since = sinceDate.toISOString().slice(0, 10);

      const labels = await this.projectSigilLabels(params.projectId);
      const sigilIds = [...labels.keys()];

      if (sigilIds.length === 0) {
        return {
          range,
          since,
          totalViews: 0,
          uniqueVisitors: 0,
          topCountries: [],
          topPaths: [],
          vitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
          timeline: this.zeroTimeline(today, days),
          errorGroups: [],
        };
      }

      const sigilList = sql.join(
        sigilIds.map((id) => sql`${id}`),
        sql`, `,
      );

      // --- Total views (raw, best-effort).
      const [totals] = await this.database.run(
        sql`
          SELECT COALESCE(SUM(${this.views.table.count}), 0) AS total
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.hour} >= ${since}
        `,
        z.object({ total: z.coerce.number() }),
      );
      const totalViews = Number(totals?.total) || 0;

      // --- Unique visitors — the headline.
      // Counted as distinct `(day, visitorHash)` pairs rather than rows: the
      // same person visiting two enrolled apps of the same project on one day
      // is one visitor, and one row per sigil would say two.
      const [uniqueAgg] = await this.database.run(
        sql`
          SELECT COUNT(DISTINCT ${this.uniques.table.day} || '|' || ${this.uniques.table.visitorHash}) AS uniques
          FROM ${this.uniques.table}
          WHERE ${this.uniques.table.sigilId} IN (${sigilList})
            AND ${this.uniques.table.day} >= ${since}
        `,
        z.object({ uniques: z.coerce.number() }),
      );
      const uniqueVisitors = Number(uniqueAgg?.uniques) || 0;

      // --- Top countries, by views desc.
      const countryRows = await this.database.run(
        sql`
          SELECT ${this.views.table.country} AS country,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.hour} >= ${since}
          GROUP BY ${this.views.table.country}
          ORDER BY count DESC
          LIMIT ${TOP_N}
        `,
        z.object({ country: z.string(), count: z.coerce.number() }),
      );
      const topCountries = countryRows.map((row) => ({
        country: row.country,
        count: Number(row.count) || 0,
      }));

      // --- Top paths, by views desc, with their share of the total.
      const pathRows = await this.database.run(
        sql`
          SELECT ${this.views.table.path} AS path,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.hour} >= ${since}
          GROUP BY ${this.views.table.path}
          ORDER BY count DESC
          LIMIT ${TOP_N}
        `,
        z.object({ path: z.string(), count: z.coerce.number() }),
      );
      const topPaths = pathRows.map((row) => {
        const count = Number(row.count) || 0;
        return {
          path: row.path,
          count,
          percentage:
            totalViews > 0 ? Math.round((count / totalViews) * 100) : 0,
        };
      });

      // --- Views over time, one point per UTC day, zero-filled.
      // `substr(hour, 1, 10)` is the day inside the hour bucket — the storage
      // stays hourly, the chart asks for days.
      const timelineRows = await this.database.run(
        sql`
          SELECT substr(${this.views.table.hour}, 1, 10) AS date,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.hour} >= ${since}
          GROUP BY substr(${this.views.table.hour}, 1, 10)
        `,
        z.object({ date: z.string(), count: z.coerce.number() }),
      );
      const byDate = new Map(
        timelineRows.map((row) => [row.date, Number(row.count) || 0]),
      );
      const timeline = this.zeroTimeline(today, days).map((point) => ({
        date: point.date,
        views: byDate.get(point.date) ?? 0,
      }));

      const vitals = await this.computeVitals(sigilIds, since);
      const errorGroups = await this.readErrorGroups(sigilIds, labels, since);

      return {
        range,
        since,
        totalViews,
        uniqueVisitors,
        topCountries,
        topPaths,
        vitals,
        timeline,
        errorGroups,
      };
    },
  });

  /**
   * Every sigil on the project, id → name.
   *
   * The ids are the join key between a project-scoped request and sigil-scoped
   * rows; the names are what makes an error budget legible, since "which app" is
   * the entire reason these rows are kept separately from the inbox. Both come
   * out of the one read the request already needed.
   */
  protected async projectSigilLabels(
    projectId: number,
  ): Promise<Map<string, string>> {
    const rows = await this.sigils.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id", "name"],
    });
    return new Map(rows.map((sigil) => [sigil.id, sigil.name]));
  }

  /**
   * The window's error groups, worst first.
   *
   * Filtered on `lastSeenAt`, not `firstSeenAt`: the question is "is this still
   * happening", so a two-year-old bug that fired an hour ago belongs in the
   * budget and one that stopped last month does not. Both columns hold full ISO
   * timestamps and `since` is a `YYYY-MM-DD` prefix of the same format, so the
   * comparison is lexicographic with no date math.
   */
  protected async readErrorGroups(
    sigilIds: string[],
    labels: Map<string, string>,
    since: string,
  ): Promise<InsightsResource["errorGroups"]> {
    const rows = await this.errorGroups.findMany({
      where: {
        sigilId: { inArray: sigilIds },
        lastSeenAt: { gte: since },
      },
      orderBy: [{ column: "count", direction: "desc" }],
      limit: TOP_ERROR_GROUPS,
    });

    return rows.map((row) => ({
      sigilId: row.sigilId,
      // The sigil is guaranteed present — the ids came from the same read, and
      // `sigil_error_groups.sigilId` cascades on delete.
      sigilLabel: labels.get(row.sigilId) ?? row.sigilId,
      fingerprint: row.fingerprint,
      name: row.name,
      message: row.message,
      count: row.count ?? 1,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }));
  }

  /** A `days`-long zero-filled `[{ date, views: 0 }]` window ending today. */
  protected zeroTimeline(
    today: Date,
    days: number,
  ): Array<{ date: string; views: number }> {
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(today);
      day.setUTCDate(day.getUTCDate() - (days - 1 - index));
      return { date: day.toISOString().slice(0, 10), views: 0 };
    });
  }

  /**
   * p75 for all five metrics, merged across every sigil on the project.
   *
   * Merged at the histogram level rather than by averaging per-sigil
   * percentiles, which would be arithmetic on numbers that cannot be averaged:
   * the p75 of two distributions is not the mean of their p75s.
   */
  protected async computeVitals(
    sigilIds: string[],
    since: string,
  ): Promise<InsightsResource["vitals"]> {
    // One read for the window, folded in memory. The histogram lives in a JSON
    // column, so there is nothing for SQL to SUM — and the row count is bounded
    // by (hour × metric × path), not by traffic.
    const rows = await this.vitals.findMany({
      where: {
        sigilId: { inArray: sigilIds },
        hour: { gte: since },
      },
      columns: ["metric", "bucketCounts"],
    });

    const histograms = new Map<string, Map<number, number>>();
    for (const row of rows) {
      const histogram = histograms.get(row.metric) ?? new Map<number, number>();
      for (const [bucket, count] of Object.entries(row.bucketCounts ?? {})) {
        const index = Number(bucket);
        histogram.set(index, (histogram.get(index) ?? 0) + Number(count));
      }
      histograms.set(row.metric, histogram);
    }

    const p75 = (metric: VitalMetric): number | null =>
      this.walkP75(histograms.get(metric), metric);

    const cls = p75("cls");
    return {
      lcp: p75("lcp"),
      // Stored ×1000 as an integer to keep the buckets free of float drift.
      cls: cls === null ? null : cls / 1000,
      inp: p75("inp"),
      fcp: p75("fcp"),
      ttfb: p75("ttfb"),
    };
  }

  /**
   * Walk a bucket histogram to the 75th percentile.
   *
   * Returns the **upper boundary** of the bucket the percentile falls in. A
   * sample that overflowed every boundary has no upper bound to report, so the
   * last boundary is returned as a conservative floor: the honest reading is
   * "at least this bad", never "exactly this".
   */
  protected walkP75(
    histogram: Map<number, number> | undefined,
    metric: VitalMetric,
  ): number | null {
    if (!histogram || histogram.size === 0) {
      return null;
    }

    let total = 0;
    for (const count of histogram.values()) {
      total += count;
    }
    if (total === 0) {
      return null;
    }

    const boundaries = VITALS_BUCKETS[metric];
    const target = Math.ceil(0.75 * total);
    let cumulative = 0;
    for (let index = 0; index <= boundaries.length; index++) {
      cumulative += histogram.get(index) ?? 0;
      if (cumulative >= target) {
        return boundaries[Math.min(index, boundaries.length - 1)];
      }
    }
    return boundaries[boundaries.length - 1];
  }
}
