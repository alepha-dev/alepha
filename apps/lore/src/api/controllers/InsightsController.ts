import type { AnalyticsVitalHistograms } from "@alepha/sigil/ingest";
import { summariseVitals } from "@alepha/sigil/ingest";
import type { VitalMetric } from "@alepha/sigil/vitals";
import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";
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
 * Every row is scoped to a sigil, and every sigil to a project, so each query
 * is `WHERE sigilId IN (the project's sigils)`. `?sigilId=` shrinks that set to
 * one app — which is all the per-app page needs, and the reason the set is
 * built as a list rather than hard-coded to the project.
 *
 * **Views and vitals are asked of `$analytics()`.** Both go through the
 * `sigil_views` / `sigil_vitals` datasets declared in `LoreAnalytics`, via the
 * question-shaped `views.query(...)` / `vitals.query(...)`. The pseudo-
 * dimension `"day"` folds hour buckets into the daily timeline with no epoch
 * math on this end, the same way the old `substr(hour, 1, 10)` group did.
 * `uniqueVisitors` stays on `LoreAnalyticsStore` (the legacy
 * `sigil_uniques_daily` table): a distinct count cannot survive sampling or a
 * rollup, so it is out of scope for `$analytics()` by construction — see
 * `LoreAnalytics`'s class doc.
 *
 * **The error budget lives here too**, and also stays on the legacy path.
 * `sigil_error_groups` is the only table that keeps failures split by app, and
 * it keeps the *first* stack sample — which needs a read before every write,
 * something an append-only analytics dataset cannot do. "Is this still
 * happening over there" is a per-app question the project-wide Blights inbox
 * cannot answer by construction. This is the surface that asks it — the same
 * range selector, the same member gate, no second route for one list.
 *
 * Reads are member-gated: analytics are not an owner secret, and the page is
 * linked from the project nav every member sees.
 */
export class InsightsController {
  protected analytics = $inject(LoreAnalyticsStore);
  protected datasets = $inject(LoreAnalytics);
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
          // Nothing was asked of a dataset, so there is nothing to have
          // sampled. `false` is also what the relational backend Lore runs
          // today would have answered anyway.
          estimated: false,
        };
      }

      // Six questions, one window. Views and vitals are asked of the
      // `$analytics()` datasets in `LoreAnalytics` — the same declaration
      // Workers Analytics Engine and a relational database both answer, so
      // this handler cannot tell which one it is talking to. Unique visitors
      // and the error budget stay on `LoreAnalyticsStore` / `sigilErrorGroups`
      // — see the class doc for why those two could not move.
      const window = { sigilIds, since };
      const analyticsWhere = { sigilId: { inArray: sigilIds } };
      const [
        uniqueVisitors,
        viewsTotal,
        topCountryResult,
        topPathResult,
        timelineResult,
        vitalsResult,
      ] = await Promise.all([
        this.analytics.uniqueVisitors(window),
        this.datasets.views.query({
          since,
          where: analyticsWhere,
          select: { count: "sum" },
        }),
        this.datasets.views.query({
          since,
          where: analyticsWhere,
          groupBy: ["country"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        this.datasets.views.query({
          since,
          where: analyticsWhere,
          groupBy: ["path"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        this.datasets.views.query({
          since,
          where: analyticsWhere,
          groupBy: ["day"],
          select: { count: "sum" },
          orderBy: { key: "day", direction: "asc" },
        }),
        this.datasets.vitals.query({
          since,
          where: analyticsWhere,
          groupBy: ["metric", "bucket"],
          select: { samples: "sum" },
        }),
      ]);

      const totalViews = Number(viewsTotal.rows[0]?.count ?? 0);

      const topCountries = topCountryResult.rows.map((row) => ({
        country: String(row.country),
        count: Number(row.count),
      }));

      const topPaths = topPathResult.rows.map((row) => ({
        path: String(row.path),
        count: Number(row.count),
        percentage:
          totalViews > 0
            ? Math.round((Number(row.count) / totalViews) * 100)
            : 0,
      }));

      // The dataset may omit days it saw nothing on — zero-filling is the
      // caller's job, and has to be, because only the caller knows how wide
      // the requested window was.
      const byDate = new Map(
        timelineResult.rows.map((row) => [String(row.day), Number(row.count)]),
      );
      const timeline = this.zeroTimeline(today, days).map((point) => ({
        date: point.date,
        views: byDate.get(point.date) ?? 0,
      }));

      // Rebuild the `bucket -> samples` histogram `summariseVitals` expects
      // from the flat `(metric, bucket)` rows the dataset returns. The walk
      // and the CLS un-scaling live in `@alepha/sigil/ingest`: every backend
      // returns histograms and none of them should re-derive either.
      const histograms: AnalyticsVitalHistograms = {};
      for (const row of vitalsResult.rows) {
        const metric = row.metric as VitalMetric;
        const bucket = histograms[metric] ?? new Map<number, number>();
        bucket.set(Number(row.bucket), Number(row.samples));
        histograms[metric] = bucket;
      }
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
        estimated: viewsTotal.estimated,
        sampleInterval: viewsTotal.sampleInterval,
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
