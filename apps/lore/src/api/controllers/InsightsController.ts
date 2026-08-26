import type { VitalMetric } from "@alepha/sigil";
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
import { DailyVisitorsService } from "../services/DailyVisitorsService.ts";
import { LoreAnalyticsStore } from "../services/LoreAnalyticsStore.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import type { AnalyticsVitalHistograms } from "../vitalsPercentile.ts";
import { summariseVitals } from "../vitalsPercentile.ts";

export type { InsightsResource };

/**
 * Lookback windows the Insights page offers, in whole UTC days.
 */
const RANGE_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
};

/**
 * How many rows the top-countries / top-paths leaderboards return.
 */
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
  /**
   * Injected for one method: `percentChange`. The rule for when a delta may
   * be shown at all — and when it must be withheld — is defined once, there,
   * and the dashboard's visitors tile reads the same one.
   */
  protected visitors = $inject(DailyVisitorsService);
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
        /**
         * Where the window ends.
         *
         * `today` (the default, and every pre-existing caller) ends the
         * window mid-day: `range: "1d"` then means **today so far**, which is
         * a different number from yesterday and one that reads as a drop
         * every morning until late evening.
         *
         * `lastCompleteDay` ends it at yesterday, so the window is whole.
         * That is the only footing on which a comparison is honest.
         */
        until: z.enum(["today", "lastCompleteDay"]).optional(),
        /**
         * Also measure the window of the same width immediately before this
         * one, and return it as `previous` with the uniques delta.
         *
         * Off by default: it is a second pass over the same tables, and the
         * pages that never show a delta should not pay for one.
         */
        compare: z.boolean().optional(),
      }),
      response: insightsResourceSchema,
    },
    handler: async ({ params, query, user }): Promise<InsightsResource> => {
      await this.security.assertMember(params.projectId, user);

      const range = query.range ?? "7d";
      const days = RANGE_DAYS[range] ?? 7;

      // The window ends today unless the caller asked for whole days only.
      // `anchor` is the last day IN the window; everything below counts back
      // from it, so the two modes differ in exactly one place.
      const today = new Date(this.dateTime.nowMillis());
      const anchor = new Date(today);
      if (query.until === "lastCompleteDay") {
        anchor.setUTCDate(anchor.getUTCDate() - 1);
      }
      const until = anchor.toISOString().slice(0, 10);
      const sinceDate = new Date(anchor);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      const since = sinceDate.toISOString().slice(0, 10);

      // The preceding window of the same width, `[previousSince ..
      // previousUntil]`, touching this one without overlapping it.
      const previousUntilDate = new Date(sinceDate);
      previousUntilDate.setUTCDate(previousUntilDate.getUTCDate() - 1);
      const previousSinceDate = new Date(previousUntilDate);
      previousSinceDate.setUTCDate(previousSinceDate.getUTCDate() - (days - 1));
      const previousWindow = {
        since: previousSinceDate.toISOString().slice(0, 10),
        until: previousUntilDate.toISOString().slice(0, 10),
      };

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
          until,
          // No apps means no traffic in either window. The comparison is
          // still ANSWERED rather than omitted when it was asked for: absent
          // means "not compared", and a caller that asked deserves the
          // difference between that and "compared, and it was zero".
          previous: query.compare
            ? { ...previousWindow, uniqueVisitors: 0, totalViews: 0 }
            : undefined,
          totalViews: 0,
          uniqueVisitors: 0,
          entries: 0,
          engagedViews: 0,
          engagementRate: 0,
          topCountries: [],
          topPaths: [],
          topEntryPaths: [],
          topCampaigns: [],
          topDevices: [],
          topReferrers: [],
          vitals: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
          timeline: this.zeroTimeline(anchor, days),
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
      const window = { sigilIds, since, until };
      const analyticsWhere = { sigilId: { inArray: sigilIds } };
      const [
        uniqueVisitors,
        viewsTotal,
        topCountryResult,
        topPathResult,
        topEntryPathResult,
        topCampaignResult,
        topDeviceResult,
        topReferrerResult,
        timelineResult,
        vitalsResult,
      ] = await Promise.all([
        this.analytics.uniqueVisitors(window),
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          select: { count: "sum", engaged: "sum", entries: "sum" },
        }),
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["country"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["path"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        // Landing pages, which `topPaths` cannot answer: that one sums every
        // view of a path, so `/` conflates arriving at the site with clicking
        // Home. `entries` is only ever incremented by a page load.
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["path"],
          select: { entries: "sum" },
          orderBy: { key: "entries", direction: "desc" },
          limit: TOP_N,
        }),
        // Summed on `entries`, not `count`: a campaign describes how a visit
        // began, so counting the visitor's later navigations against it would
        // reward tagged links for how much the visitor happened to read.
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["campaign"],
          select: { entries: "sum" },
          orderBy: { key: "entries", direction: "desc" },
          limit: TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["device"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        // `direct` is not excluded here even though it is never the answer
        // anyone is looking for. It is the denominator: without it on the
        // same leaderboard, "12 views from Hacker News" reads as a share of
        // the referred traffic rather than of the traffic, and on a site
        // whose visitors mostly arrive unattributed those differ by an order
        // of magnitude.
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["referrer"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["day"],
          select: { count: "sum" },
          orderBy: { key: "day", direction: "asc" },
        }),
        this.datasets.vitals.query({
          since,
          until,
          where: analyticsWhere,
          groupBy: ["metric", "bucket"],
          select: { samples: "sum" },
        }),
      ]);

      const totalViews = Number(viewsTotal.rows[0]?.count ?? 0);
      const entries = Number(viewsTotal.rows[0]?.entries ?? 0);
      const engagedViews = Number(viewsTotal.rows[0]?.engaged ?? 0);
      const engagementRate =
        totalViews > 0 ? Math.round((engagedViews / totalViews) * 100) : 0;

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

      const topEntryPaths = topEntryPathResult.rows.map((row) => ({
        path: String(row.path),
        count: Number(row.entries),
        percentage:
          entries > 0 ? Math.round((Number(row.entries) / entries) * 100) : 0,
      }));

      const topCampaigns = topCampaignResult.rows.map((row) => ({
        campaign: String(row.campaign),
        count: Number(row.entries),
      }));

      const topDevices = topDeviceResult.rows.map((row) => ({
        device: String(row.device),
        count: Number(row.count),
      }));

      const topReferrers = topReferrerResult.rows.map((row) => ({
        referrer: String(row.referrer),
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
      const timeline = this.zeroTimeline(anchor, days).map((point) => ({
        date: point.date,
        views: byDate.get(point.date) ?? 0,
      }));

      // Rebuild the `bucket -> samples` histogram `summariseVitals` expects
      // from the flat `(metric, bucket)` rows the dataset returns. The walk
      // and the CLS un-scaling live in `../vitalsPercentile.ts`: every backend
      // returns histograms and none of them should re-derive either.
      const histograms: AnalyticsVitalHistograms = {};
      for (const row of vitalsResult.rows) {
        const metric = row.metric as VitalMetric;
        const bucket = histograms[metric] ?? new Map<number, number>();
        bucket.set(Number(row.bucket), Number(row.samples));
        histograms[metric] = bucket;
      }
      const vitals = summariseVitals(histograms);
      const errorGroups = await this.readErrorGroups(
        sigilIds,
        labels,
        since,
        until,
      );

      const previous = query.compare
        ? await this.readPreviousWindow(sigilIds, previousWindow)
        : undefined;

      return {
        range,
        since,
        until,
        previous,
        uniqueVisitorsDelta: this.visitors.percentChange(
          previous?.uniqueVisitors,
          uniqueVisitors,
        ),
        totalViews,
        uniqueVisitors,
        entries,
        engagedViews,
        engagementRate,
        topCountries,
        topPaths,
        topEntryPaths,
        topCampaigns,
        topDevices,
        topReferrers,
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
   *
   * `until` bounds the top end the same way. It is a DAY, and the column is a
   * full timestamp, so the bound has to be the day plus a `~` sentinel: every
   * character a timestamp can carry after the date sorts below it, so
   * `2026-08-20T23:59` is in and `2026-08-21T00:00` is out. `<= "2026-08-20"`
   * would exclude the whole day it names.
   */
  protected async readErrorGroups(
    sigilIds: string[],
    labels: Map<string, string>,
    since: string,
    until: string,
  ): Promise<InsightsResource["errorGroups"]> {
    const rows = await this.errorGroups.findMany({
      where: {
        sigilId: { inArray: sigilIds },
        lastSeenAt: { gte: since, lte: `${until}~` },
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

  /**
   * The preceding window, measured the same way as the current one.
   *
   * Uniques and views only. A comparison needs a magnitude, not a second copy
   * of the leaderboards — and the tile that asks for this shows one number
   * with one delta beside it. Running the other eight queries again to feed a
   * `+11%` would double the cost of every dashboard resolve for figures
   * nothing reads.
   *
   * `uniqueVisitors` is what the delta is computed on. `totalViews` rides
   * along because it costs nothing extra once the window is open, and it is
   * labelled best-effort in both windows alike.
   */
  protected async readPreviousWindow(
    sigilIds: string[],
    window: { since: string; until: string },
  ): Promise<NonNullable<InsightsResource["previous"]>> {
    const [uniqueVisitors, views] = await Promise.all([
      this.analytics.uniqueVisitors({ sigilIds, ...window }),
      this.datasets.views.query({
        since: window.since,
        until: window.until,
        where: { sigilId: { inArray: sigilIds } },
        select: { count: "sum" },
      }),
    ]);

    return {
      ...window,
      uniqueVisitors,
      totalViews: Number(views.rows[0]?.count ?? 0),
    };
  }

  /**
   * A `days`-long zero-filled `[{ date, views: 0 }]` window ending on
   * `anchor` — today for an ordinary read, yesterday for a complete-day one.
   */
  protected zeroTimeline(
    anchor: Date,
    days: number,
  ): Array<{ date: string; views: number }> {
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(anchor);
      day.setUTCDate(day.getUTCDate() - (days - 1 - index));
      return { date: day.toISOString().slice(0, 10), views: 0 };
    });
  }
}
