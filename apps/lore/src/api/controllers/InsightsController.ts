import { summariseVitals } from "@alepha/sigil/ingest";
import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import {
  type InsightsResource,
  insightsResourceSchema,
} from "../schemas/insightsResourceSchema.ts";
import { LoreAnalyticsStore } from "../services/LoreAnalyticsStore.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export type { InsightsResource };

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
 * The reading surface for what `SigilIngestService` writes.
 *
 * Every row it aggregates is scoped to a sigil, and every sigil to a project,
 * so each query is `WHERE sigil_id IN (the project's sigils)`. `?sigilId=`
 * shrinks that set to one app — which is all the per-app page needs, and the
 * reason the set is built as a list rather than hard-coded to the project.
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
  protected analytics = $inject(LoreAnalyticsStore);
  protected security = $inject(ProjectSecurityService);
  protected dateTime = $inject(DateTimeProvider);
  protected sigils = $repository(sigils);
  protected errorGroups = $repository(sigilErrorGroups);

  getInsights = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/insights",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        range: z.enum(["1d", "7d", "30d"]).optional(),
        /**
         * Narrow every segment to a single enrolled app.
         *
         * Omitted, the answer is the project as a whole — the shape every
         * caller had before the per-app page existed.
         */
        sigilId: z.uuid().optional(),
      }),
      response: insightsResourceSchema,
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
      // The membership check above is on the *project*, so a sigil id from the
      // client has to be proved to belong to it before it narrows anything —
      // otherwise `?sigilId=` would read another project's rows through a
      // project the caller happens to be a member of. `labels` is the project's
      // own set, so containment is the proof. A stranger's id is a 404 rather
      // than an empty window: the two are different answers, and "no such app
      // here" is the true one.
      let sigilIds = [...labels.keys()];
      if (query.sigilId) {
        if (!labels.has(query.sigilId)) {
          throw new NotFoundError("Sigil not found");
        }
        sigilIds = [query.sigilId];
      }

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

      // Five questions, one window, asked of the store rather than of a table.
      // The SQL that used to sit here now lives in `OrmAnalyticsStore`
      // (`@alepha/sigil/ingest`) — the point being that Workers Analytics
      // Engine can answer the same five with a completely different strategy,
      // and this handler cannot tell which one it is talking to.
      const window = { sigilIds, since };
      const [
        totalViews,
        uniqueVisitors,
        topCountryRows,
        topPathRows,
        timelinePoints,
        histograms,
      ] = await Promise.all([
        this.analytics.totalViews(window),
        this.analytics.uniqueVisitors(window),
        this.analytics.topCountries(window, TOP_N),
        this.analytics.topPaths(window, TOP_N),
        this.analytics.timeline(window),
        this.analytics.vitalHistograms(window),
      ]);

      const topCountries = topCountryRows.map((row) => ({
        country: row.key,
        count: row.count,
      }));

      const topPaths = topPathRows.map((row) => ({
        path: row.key,
        count: row.count,
        percentage:
          totalViews > 0 ? Math.round((row.count / totalViews) * 100) : 0,
      }));

      // The store may omit days it saw nothing on — zero-filling is the
      // caller's job, and has to be, because only the caller knows how wide
      // the requested window was.
      const byDate = new Map(timelinePoints.map((p) => [p.date, p.views]));
      const timeline = this.zeroTimeline(today, days).map((point) => ({
        date: point.date,
        views: byDate.get(point.date) ?? 0,
      }));

      // The walk and the CLS un-scaling live in `@alepha/sigil/ingest`: every
      // store returns histograms and none of them should re-derive this,
      // least of all the ÷1000 that undoes the collector's integer scaling.
      const vitals = summariseVitals(histograms);
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
}
