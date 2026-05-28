import { $inject, type Static, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { sigils } from "../entities/sigils.ts";
import { sigilUniqueVisitors } from "../entities/sigilUniqueVisitors.ts";
import { sigilViews } from "../entities/sigilViews.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

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
const insightsSchema = t.object({
  range: t.enum(["1d", "7d", "30d"]),
  /** First UTC day included in the window, `YYYY-MM-DD`. */
  since: t.string(),
  /** Best-effort raw pageview count. Inflatable — see entity note. */
  totalViews: t.integer(),
  /** Abuse-resistant headline metric: distinct daily session hashes. */
  uniqueVisitors: t.integer(),
  topCountries: t.array(
    t.object({
      /** ISO-3166 alpha-2, or `ZZ` for unknown. */
      country: t.string(),
      count: t.integer(),
    }),
  ),
  topPaths: t.array(
    t.object({
      path: t.string(),
      count: t.integer(),
      /** Share of `totalViews`, rounded to a whole percent. */
      percentage: t.number(),
    }),
  ),
  timeline: t.array(
    t.object({
      /** UTC day, `YYYY-MM-DD`. */
      date: t.string(),
      views: t.integer(),
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
  protected sigils = $repository(sigils);
  protected views = $repository(sigilViews);
  protected uniques = $repository(sigilUniqueVisitors);

  getInsights = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/insights",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({
        range: t.optional(t.enum(["1d", "7d", "30d"])),
      }),
      response: insightsSchema,
    },
    handler: async ({ params, query, user }): Promise<InsightsResource> => {
      await this.security.assertOwner(params.campaignId, user);

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
      if (sigilIds.length === 0) {
        return {
          range,
          since,
          totalViews: 0,
          uniqueVisitors: 0,
          topCountries: [],
          topPaths: [],
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
        t.object({ total: t.string() }),
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
        t.object({ uniques: t.string() }),
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
        t.object({ country: t.string(), count: t.string() }),
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
        t.object({ path: t.string(), count: t.string() }),
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
        t.object({ date: t.string(), count: t.string() }),
      );
      const byDate = new Map(
        timelineRows.map((r) => [r.date, Number(r.count) || 0]),
      );
      const timeline = this.zeroTimeline(today, days).map((p) => ({
        date: p.date,
        views: byDate.get(p.date) ?? 0,
      }));

      return {
        range,
        since,
        totalViews,
        uniqueVisitors,
        topCountries,
        topPaths,
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
