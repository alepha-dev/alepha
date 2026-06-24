import { $inject, type Static, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { sigils } from "../entities/sigils.ts";
import { sigilUniqueVisitors } from "../entities/sigilUniqueVisitors.ts";
import { sigilViews } from "../entities/sigilViews.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { VitalsIngestService } from "../services/VitalsIngestService.ts";

/** Supported lookback windows for the Insights dashboard. */
const RANGE_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
};

/** How many rows the top-countries / top-paths leaderboards return. */
const TOP_N = 10;

/**
 * The Beacons Insights payload — an umami-style, privacy-first analytics
 * snapshot for a campaign over a 1d / 7d / 30d window.
 *
 * ⚠️ `totalViews` is best-effort by design: the `/beacon` endpoint has no
 * per-IP throughput cap, so the raw `count` is inflatable (folio #12). The
 * trustworthy headline metric is `uniqueVisitors`. The UI labels the views
 * card accordingly.
 */
const insightsSchema = z.object({
  range: z.enum(["1d", "7d", "30d"]),
  /** First UTC day included in the window, `YYYY-MM-DD`. */
  since: z.string(),
  /** Best-effort raw pageview count. Inflatable — see entity note. */
  totalViews: z.integer(),
  /** Abuse-resistant headline metric: distinct daily session hashes. */
  uniqueVisitors: z.integer(),
  topCountries: z.array(
    z.object({
      /** ISO-3166 alpha-2, or `ZZ` for unknown. */
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
   * Web-Vitals p75 approximations across all campaign sigils for the window.
   *
   * Each value is the 75th-percentile approximation derived from histogram
   * bucket counts. `null` means no samples were recorded for that metric in
   * the selected range.
   *
   * CLS is stored as integers (value × 1000) to avoid floating-point drift;
   * the value here has been divided by 1000 and represents the real CLS score
   * (e.g. 0.08, not 80).
   */
  vitals: z.object({
    /** Largest Contentful Paint p75, ms. */
    lcp: z.number().nullable(),
    /** Cumulative Layout Shift p75, unitless (real value, ÷1000 applied). */
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
});

export type InsightsResource = Static<typeof insightsSchema>;

/**
 * Owner-facing Beacons analytics — the viewing surface for the pageview
 * data ingested by `BeaconIngestService` (`sigil_views` +
 * `sigil_unique_visitors`).
 *
 * Mirrors `CampaignStatsController`: one owner-gated aggregation endpoint
 * feeding a charts page. Beacons rows are scoped to sigils and sigils are
 * scoped to campaigns, so every query joins through the campaign's sigils
 * (`WHERE sigil_id IN (campaign's sigils)`).
 *
 * The `date` columns store a `YYYY-MM-DD` UTC string, so range filtering is
 * a plain lexicographic `date >= since` comparison — no epoch math.
 */
export class InsightsController {
  protected database = $inject(DatabaseProvider);
  protected security = $inject(AppSecurityProvider);
  protected dt = $inject(DateTimeProvider);
  protected vitalsService = $inject(VitalsIngestService);
  protected sigils = $repository(sigils);
  protected views = $repository(sigilViews);
  protected uniques = $repository(sigilUniqueVisitors);

  getInsights = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/insights",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      query: z.object({
        range: z.enum(["1d", "7d", "30d"]).optional(),
      }),
      response: insightsSchema,
    },
    handler: async ({ params, query, user }): Promise<InsightsResource> => {
      await this.security.assertMember(params.campaignId, user);

      const range = query.range ?? "7d";
      const days = RANGE_DAYS[range] ?? 7;

      // UTC day window. `since` is the first day included; a `days`-wide
      // window of N days covers [today-(N-1) .. today].
      const today = new Date(this.dt.nowMillis());
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);
      const sinceDate = new Date(today);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      const since = dayKey(sinceDate);

      const sigilIds = await this.campaignSigilIds(params.campaignId);

      /** Null vitals object returned when there are no sigils or no samples. */
      const nullVitals = {
        lcp: null,
        cls: null,
        inp: null,
        fcp: null,
        ttfb: null,
      };

      if (sigilIds.length === 0) {
        return {
          range,
          since,
          totalViews: 0,
          uniqueVisitors: 0,
          topCountries: [],
          topPaths: [],
          vitals: nullVitals,
          timeline: this.zeroTimeline(today, days),
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
            AND ${this.views.table.date} >= ${since}
        `,
        z.object({ total: z.coerce.number() }),
      );
      const totalViews = Number(totals?.total) || 0;

      // --- Unique visitors (distinct daily session hashes — the headline).
      // Dedup across sigils: the same visitor (same session_hash, same day)
      // hitting two sigils in this campaign must count once, so we count
      // distinct (date, session_hash) pairs rather than raw rows.
      const [uniqueAgg] = await this.database.run(
        sql`
          SELECT COUNT(DISTINCT ${this.uniques.table.date} || '|' || ${this.uniques.table.sessionHash}) AS uniques
          FROM ${this.uniques.table}
          WHERE ${this.uniques.table.sigilId} IN (${sigilList})
            AND ${this.uniques.table.date} >= ${since}
        `,
        z.object({ uniques: z.coerce.number() }),
      );
      const uniqueVisitors = Number(uniqueAgg?.uniques) || 0;

      // --- Top countries (by view count, desc).
      const countryRows = await this.database.run(
        sql`
          SELECT ${this.views.table.country} AS country,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.date} >= ${since}
          GROUP BY ${this.views.table.country}
          ORDER BY count DESC
          LIMIT ${TOP_N}
        `,
        z.object({ country: z.string(), count: z.coerce.number() }),
      );
      const topCountries = countryRows.map((r) => ({
        country: r.country,
        count: Number(r.count) || 0,
      }));

      // --- Top paths (by view count, desc) with percentage of totalViews.
      const pathRows = await this.database.run(
        sql`
          SELECT ${this.views.table.path} AS path,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.date} >= ${since}
          GROUP BY ${this.views.table.path}
          ORDER BY count DESC
          LIMIT ${TOP_N}
        `,
        z.object({ path: z.string(), count: z.coerce.number() }),
      );
      const topPaths = pathRows.map((r) => {
        const count = Number(r.count) || 0;
        return {
          path: r.path,
          count,
          percentage:
            totalViews > 0 ? Math.round((count / totalViews) * 100) : 0,
        };
      });

      // --- Views over time (per UTC day), zero-filled across the window.
      const timelineRows = await this.database.run(
        sql`
          SELECT ${this.views.table.date} AS date,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${sigilList})
            AND ${this.views.table.date} >= ${since}
          GROUP BY ${this.views.table.date}
        `,
        z.object({ date: z.string(), count: z.coerce.number() }),
      );
      const byDate = new Map(
        timelineRows.map((r) => [r.date, Number(r.count) || 0]),
      );
      const timeline = this.zeroTimeline(today, days).map((p) => ({
        date: p.date,
        views: byDate.get(p.date) ?? 0,
      }));

      // --- Web-Vitals p75 across all campaign sigils for the window.
      // Must aggregate bucket counts across sigils in a single query per metric
      // (averaging per-sigil percentiles is statistically incorrect). CLS is
      // stored as integer × 1000 to avoid floating-point drift; divide by 1000
      // here to return the real score.
      const vitalsOpts = { from: since, to: dayKey(today) };
      const [lcpRaw, clsRaw, inpRaw, fcpRaw, ttfbRaw] = await Promise.all([
        this.vitalsService.computeP75ForSigils(sigilIds, "lcp", vitalsOpts),
        this.vitalsService.computeP75ForSigils(sigilIds, "cls", vitalsOpts),
        this.vitalsService.computeP75ForSigils(sigilIds, "inp", vitalsOpts),
        this.vitalsService.computeP75ForSigils(sigilIds, "fcp", vitalsOpts),
        this.vitalsService.computeP75ForSigils(sigilIds, "ttfb", vitalsOpts),
      ]);
      const vitals = {
        lcp: lcpRaw,
        cls: clsRaw !== null ? clsRaw / 1000 : null,
        inp: inpRaw,
        fcp: fcpRaw,
        ttfb: ttfbRaw,
      };

      return {
        range,
        since,
        totalViews,
        uniqueVisitors,
        topCountries,
        topPaths,
        vitals,
        timeline,
      };
    },
  });

  /**
   * Resolve the ids of every sigil belonging to a campaign — the join key
   * between campaign-scoped requests and sigil-scoped Beacons rows. Revoked
   * sigils are included: their historical pageviews stay visible.
   */
  protected async campaignSigilIds(campaignId: number): Promise<string[]> {
    const rows = await this.sigils.findMany(
      { where: { campaignId: { eq: campaignId } } },
      { force: true },
    );
    return rows.map((s) => s.id);
  }

  /** A `days`-long zero-filled `[{ date, views: 0 }]` window ending today. */
  protected zeroTimeline(
    today: Date,
    days: number,
  ): Array<{ date: string; views: number }> {
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      return { date: d.toISOString().slice(0, 10), views: 0 };
    });
  }
}
