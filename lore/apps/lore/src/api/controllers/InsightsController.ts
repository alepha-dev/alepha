import {
  VITALS_BUCKETS,
  VITALS_THRESHOLDS,
  type VitalMetric,
} from "@alepha/lore/sigil";
import { $inject, z } from "alepha";
import type { AnalyticsDataset, AnalyticsFilter } from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import {
  type InsightsDimensionResource,
  insightsDimensionResourceSchema,
} from "../schemas/insightsDimensionResourceSchema.ts";
import {
  type InsightsResource,
  insightsResourceSchema,
} from "../schemas/insightsResourceSchema.ts";
import {
  type TrafficFilter,
  trafficFilterSchema,
} from "../schemas/trafficFilterSchema.ts";
import {
  type VitalsPathsResource,
  vitalsPathsResourceSchema,
} from "../schemas/vitalsPathsResourceSchema.ts";
import { DailyVisitorsService } from "../services/DailyVisitorsService.ts";
import { LoreAnalyticsStore } from "../services/LoreAnalyticsStore.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import type { AnalyticsVitalHistograms } from "../vitalsPercentile.ts";
import { summariseVitals } from "../vitalsPercentile.ts";

export type { InsightsResource };

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
  /**
   * Lookback windows the Insights page offers, in whole UTC days.
   */
  protected readonly RANGE_DAYS: Record<string, number> = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
  };

  /**
   * How many rows the top-countries / top-paths leaderboards return.
   */
  protected readonly TOP_N = 10;

  /**
   * How many error groups the budget section returns.
   *
   * Wider than the leaderboards on purpose: an error budget you have to paginate
   * is one nobody reads to the bottom, and the tail is where a new regression
   * shows up before it is anyone's top ten.
   */
  protected readonly TOP_ERROR_GROUPS = 20;

  /**
   * Every `traffic` value that counts as a person.
   *
   * Two of them, and the second one is the whole reason this is a set. A row
   * written before the `traffic` dimension existed carries `""` - a default fills
   * a column on write, it does not rewrite rows already stored - and the filter
   * has to decide what those legacy rows are. They are people: the dimension is
   * an addition to what is recorded, not a reclassification of what was, and
   * dropping every view older than the deploy out of the humans view would look
   * exactly like the traffic collapsing on that date.
   *
   * A `notInArray` on `bot` would say the same thing in one term, and
   * `AnalyticsFilter` deliberately has no negation: equality and set membership
   * only, on both backends. Enumerating the positive side is the shape that seam
   * accepts, and it fails loudly if a third value is ever introduced without
   * being classified here - which is the better failure.
   */
  protected readonly HUMAN_TRAFFIC = ["human", ""];

  /**
   * The `sigil_views` dimensions a request may narrow by.
   *
   * `sigilId` is not one of them: it is proved against the project's own set
   * before it filters anything, which is a membership check rather than a
   * dimension filter, and it must not be reachable through the same loop.
   */
  protected readonly VIEW_FILTER_KEYS = [
    "path",
    "country",
    "referrer",
    "campaign",
    "device",
    "browser",
    "os",
  ] as const;

  /**
   * How each expandable leaderboard is asked for: which dimension it groups by,
   * and which measure it is ranked and shared out by.
   *
   * `entryPath` is not a dimension - it groups by `path` like `path` does, and
   * differs only in the measure. That distinction is the whole reason it
   * exists: `count` sums every view of a path, so `/` conflates arriving at the
   * site with clicking Home, while `entries` is only ever incremented by a page
   * load. `campaign` is summed on `entries` for the neighbouring reason - a
   * campaign describes how a visit began, so counting the visitor's later
   * navigations against it would reward tagged links for how much the visitor
   * happened to read.
   */
  protected readonly DIMENSION_PLAN: Record<
    InsightsDimensionResource["dimension"],
    { groupBy: string; measure: InsightsDimensionResource["measure"] }
  > = {
    country: { groupBy: "country", measure: "count" },
    path: { groupBy: "path", measure: "count" },
    entryPath: { groupBy: "path", measure: "entries" },
    campaign: { groupBy: "campaign", measure: "entries" },
    device: { groupBy: "device", measure: "count" },
    referrer: { groupBy: "referrer", measure: "count" },
    browser: { groupBy: "browser", measure: "count" },
    os: { groupBy: "os", measure: "count" },
  };

  /**
   * How deep a single-dimension listing may be paged.
   *
   * The analytics seam has no `offset`, so a page is served by asking for
   * `offset + limit + 1` rows and dropping the head - which means the depth is
   * the query's real cost, not the page size. A cap keeps a hand-written
   * `?offset=100000` from turning a leaderboard into a scan of the window.
   *
   * Deliberately generous against real data: the widest leaderboard here is
   * countries, at roughly 200 distinct values.
   */
  protected readonly MAX_DIMENSION_DEPTH = 500;

  /**
   * Rows per page of a single-dimension listing, when the caller does not say.
   */
  protected readonly DIMENSION_PAGE = 50;

  /**
   * How many paths the per-path vitals table ranks, and how many it returns.
   *
   * Two numbers because the ranking key is not the query's ordering key. The
   * dataset can order by sample count; it cannot order by "share of samples in
   * a poor bucket", which has to be computed from the histograms. So the widest
   * `CANDIDATES` paths by volume are pulled, ranked here, and the worst
   * `ROWS` returned.
   *
   * ⚠️ The consequence is real and worth stating: a low-volume path with a
   * terrible tail is invisible if it falls outside the busiest 50. That is the
   * same direction as the sample floor - a route nobody visits is not the
   * problem page - but it is a limit, not a property.
   */
  protected readonly VITALS_PATH_CANDIDATES = 50;
  protected readonly VITALS_PATH_ROWS = 20;

  /**
   * Below this many samples a path's reading is a hint, not a measurement.
   *
   * The same floor `AppVitalsCard` applies to a metric, for the same reason: a
   * path with three samples will happily claim to be the worst on the site.
   * Applied to the ranking rather than to the list, so such a row is ranked
   * last and marked rather than hidden - "not enough data about this page" is a
   * real answer.
   */
  protected readonly VITALS_PATH_MIN_SAMPLES = 30;

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
        /**
         * Which traffic to count: everything, people, or crawlers.
         *
         * Omitted means `all`, which is what every caller predating this got
         * and is deliberately still the default. A dashboard that silently
         * hid part of the traffic would be a worse lie than one that mixes
         * it: the mixing is at least visible in the engagement rate.
         *
         * `humans` is the interesting one and the reason this exists. On this
         * project's own docs app roughly 85% of recorded views are automated,
         * measured over 30 days, and reading that number as readership is
         * how a documentation site convinces itself it has an audience.
         */
        traffic: trafficFilterSchema.optional(),
        /**
         * Narrow every view-derived number to one value of one dimension.
         *
         * The five of them are the `sigil_views` dimensions a leaderboard row
         * names, and they exist so that clicking such a row can filter the
         * whole page rather than open a second one. They compose: `country=FR`
         * with `device=mobile` is one `WHERE`, not two requests.
         *
         * ⚠️ They do NOT narrow `uniqueVisitors`, which is read from another
         * table entirely. That is stated on the response as
         * `uniqueVisitorsIgnores` rather than left for a reader to discover -
         * see the field's own doc for the cost reasoning.
         */
        path: z.string().optional(),
        country: z.string().optional(),
        referrer: z.string().optional(),
        campaign: z.string().optional(),
        device: z.string().optional(),
        browser: z.string().optional(),
        os: z.string().optional(),
      }),
      response: insightsResourceSchema,
    },
    handler: async ({ params, query, user }): Promise<InsightsResource> => {
      await this.security.assertMember(params.projectId, user);

      const range = query.range ?? "7d";
      // Resolved once, then echoed back on the payload: the page renders the
      // filter from what it received, not from what it asked for.
      const traffic = query.traffic ?? "all";
      const { days, anchor, since, until, previousWindow } = this.resolveWindow(
        range,
        query.until,
      );

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
          traffic,
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
          // Nothing was narrowed because nothing was counted. A list of
          // ignored filters here would describe a discrepancy between two
          // zeros.
          uniqueVisitorsIgnores: [],
          entries: 0,
          engagedViews: 0,
          engagementRate: 0,
          topCountries: [],
          topPaths: [],
          topEntryPaths: [],
          topCampaigns: [],
          topDevices: [],
          topReferrers: [],
          topBrowsers: [],
          topSystems: [],
          // Every metric present with zero samples rather than nulls: a page
          // with no apps and a page whose apps have sent no vitals are the
          // same shape, so the tab renders "no samples yet" in both instead
          // of branching on which kind of nothing it got.
          vitals: summariseVitals({}),
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
      const window = { sigilIds, since, until, traffic };
      // ONE filter object, narrowed per dataset by what that dataset declares.
      //
      // It used to be a hand-maintained pair - a plain `sigilId` where for
      // vitals and a `traffic`-carrying one for views - because `traffic` is a
      // dimension of exactly one of the two, and the query planner rejects a
      // filter naming a dimension a dataset does not have. Sharing one object
      // was a 500 on the Vitals tab, and a test caught it. A pair survives
      // exactly one dimension of divergence, and there are five more now:
      // `path` is legal against vitals, `country` / `referrer` / `campaign` /
      // `device` are not. `whereFor` derives each dataset's slice from the
      // dataset itself, so the next dimension needs no edit here and cannot
      // reintroduce that 500.
      //
      // `uniqueVisitors` is narrowed through `window`, not through either of
      // these: it reads `sigil_uniques_daily`, which carries `traffic` and no
      // other dimension - hence `uniqueVisitorsIgnores` on the response. The
      // error budget is narrowed by neither, because an error is not a view
      // and a crawler's crash is still this app's crash.
      const filters = {
        sigilId: { inArray: sigilIds },
        ...this.trafficFilter(traffic),
        ...this.viewFilters(query),
      };
      const viewsWhere = this.whereFor(this.datasets.views.dataset, filters);
      const analyticsWhere = this.whereFor(
        this.datasets.vitals.dataset,
        filters,
      );
      const [
        uniqueVisitors,
        viewsTotal,
        topCountryResult,
        topPathResult,
        topEntryPathResult,
        topCampaignResult,
        topDeviceResult,
        topReferrerResult,
        topBrowserResult,
        topSystemResult,
        timelineResult,
        vitalsResult,
      ] = await Promise.all([
        this.analytics.uniqueVisitors(window),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          select: { count: "sum", engaged: "sum", entries: "sum" },
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["country"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["path"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
        }),
        // Landing pages, which `topPaths` cannot answer: that one sums every
        // view of a path, so `/` conflates arriving at the site with clicking
        // Home. `entries` is only ever incremented by a page load.
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["path"],
          select: { entries: "sum" },
          orderBy: { key: "entries", direction: "desc" },
          limit: this.TOP_N,
        }),
        // Summed on `entries`, not `count`: a campaign describes how a visit
        // began, so counting the visitor's later navigations against it would
        // reward tagged links for how much the visitor happened to read.
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["campaign"],
          select: { entries: "sum" },
          orderBy: { key: "entries", direction: "desc" },
          limit: this.TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["device"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
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
          where: viewsWhere,
          groupBy: ["referrer"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["browser"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
          groupBy: ["os"],
          select: { count: "sum" },
          orderBy: { key: "count", direction: "desc" },
          limit: this.TOP_N,
        }),
        this.datasets.views.query({
          since,
          until,
          where: viewsWhere,
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

      // `""` folded into `other` rather than dropped: both readings are "we
      // cannot name it", and excluding the legacy rows would silently make
      // these shares describe less traffic than the page claims. Summed after
      // the fold, so the two buckets become one row rather than two.
      const topBrowsers = this.foldUnknown(topBrowserResult.rows, "browser");
      const topSystems = this.foldUnknown(topSystemResult.rows, "os");

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
        ? await this.readPreviousWindow(
            sigilIds,
            previousWindow,
            traffic,
            viewsWhere,
          )
        : undefined;

      return {
        range,
        traffic,
        since,
        until,
        previous,
        uniqueVisitorsDelta: this.visitors.percentChange(
          previous?.uniqueVisitors,
          uniqueVisitors,
        ),
        totalViews,
        uniqueVisitors,
        uniqueVisitorsIgnores: this.uniqueVisitorsIgnores(filters),
        entries,
        engagedViews,
        engagementRate,
        topCountries,
        topPaths,
        topEntryPaths,
        topCampaigns,
        topDevices,
        topReferrers,
        topBrowsers,
        topSystems,
        vitals,
        timeline,
        errorGroups,
        estimated: viewsTotal.estimated,
        sampleInterval: viewsTotal.sampleInterval,
      };
    },
  });

  getInsightsDimension = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/insights/dimensions/:dimension",
    schema: {
      params: z.object({
        projectId: z.integer(),
        dimension: insightsDimensionResourceSchema.shape.dimension,
      }),
      query: z.object({
        range: z.enum(["1d", "7d", "30d"]).optional(),
        sigilId: z.uuid().optional(),
        until: z.enum(["today", "lastCompleteDay"]).optional(),
        traffic: trafficFilterSchema.optional(),
        path: z.string().optional(),
        country: z.string().optional(),
        referrer: z.string().optional(),
        campaign: z.string().optional(),
        device: z.string().optional(),
        browser: z.string().optional(),
        os: z.string().optional(),
        /**
         * Rows to return. The overview draws ten; this exists for the view
         * that draws the rest.
         */
        limit: z.integer().min(1).max(200).optional(),
        offset: z.integer().min(0).optional(),
        /**
         * Ascending shows the tail - the pages nobody reads, the countries
         * with one visit - which is a real question and the reason this is
         * not hard-coded to `desc`.
         */
        direction: z.enum(["asc", "desc"]).optional(),
      }),
      response: insightsDimensionResourceSchema,
    },
    handler: async ({
      params,
      query,
      user,
    }): Promise<InsightsDimensionResource> => {
      await this.security.assertMember(params.projectId, user);

      const plan = this.DIMENSION_PLAN[params.dimension];
      const range = query.range ?? "7d";
      const traffic = query.traffic ?? "all";
      const limit = query.limit ?? this.DIMENSION_PAGE;
      const offset = query.offset ?? 0;
      const direction = query.direction ?? "desc";
      const { since, until } = this.resolveWindow(range, query.until);

      const labels = await this.projectSigilLabels(params.projectId);
      let sigilIds = [...labels.keys()];
      if (query.sigilId) {
        if (!labels.has(query.sigilId)) {
          throw new NotFoundError("Sigil not found");
        }
        sigilIds = [query.sigilId];
      }

      const empty = {
        dimension: params.dimension,
        measure: plan.measure,
        range,
        traffic,
        since,
        until,
        total: 0,
        rows: [],
        offset,
        limit,
        hasMore: false,
        estimated: false,
      };
      if (sigilIds.length === 0) {
        return empty;
      }

      // One row past the page, so `hasMore` costs a row instead of a second
      // pass. Refused rather than clamped past the cap: a caller that asked
      // for page 200 of a 200-value leaderboard has a bug, and answering it
      // with page 10 would hide the bug behind plausible data.
      const depth = offset + limit + 1;
      if (depth > this.MAX_DIMENSION_DEPTH) {
        throw new NotFoundError("Page is past the end of this leaderboard");
      }

      const filters = {
        sigilId: { inArray: sigilIds },
        ...this.trafficFilter(traffic),
        ...this.viewFilters(query),
      };
      const where = this.whereFor(this.datasets.views.dataset, filters);

      const [totals, page] = await Promise.all([
        // The denominator, under the same filter. It has to be a separate
        // question: the page sums to a share of the page, and dividing by
        // that would report every row as a large fraction of nothing.
        this.datasets.views.query({
          since,
          until,
          where,
          select: { [plan.measure]: "sum" },
        }),
        this.datasets.views.query({
          since,
          until,
          where,
          groupBy: [plan.groupBy],
          select: { [plan.measure]: "sum" },
          orderBy: { key: plan.measure, direction },
          limit: depth,
        }),
      ]);

      const total = Number(totals.rows[0]?.[plan.measure] ?? 0);
      const window = page.rows.slice(offset, offset + limit);

      return {
        ...empty,
        total,
        rows: window.map((row) => ({
          value: String(row[plan.groupBy]),
          count: Number(row[plan.measure]),
          percentage:
            total > 0
              ? Math.round((Number(row[plan.measure]) / total) * 100)
              : 0,
        })),
        hasMore: page.rows.length > offset + limit,
        estimated: page.estimated,
        sampleInterval: page.sampleInterval,
      };
    },
  });

  getVitalsPaths = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/insights/vitals-paths",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        range: z.enum(["1d", "7d", "30d"]).optional(),
        sigilId: z.uuid().optional(),
        until: z.enum(["today", "lastCompleteDay"]).optional(),
        /**
         * Narrow to one page, the only one of the five view filters
         * `sigil_vitals` declares. The other four are not legal against this
         * dataset, which is why `whereFor` derives each dataset's slice rather
         * than sharing one object.
         */
        path: z.string().optional(),
      }),
      response: vitalsPathsResourceSchema,
    },
    handler: async ({ params, query, user }): Promise<VitalsPathsResource> => {
      await this.security.assertMember(params.projectId, user);

      const range = query.range ?? "7d";
      const { since, until } = this.resolveWindow(range, query.until);
      const boundaries = Object.fromEntries(
        Object.entries(VITALS_BUCKETS).map(([metric, bounds]) => [
          metric,
          bounds.map((value) => value / (metric === "cls" ? 1000 : 1)),
        ]),
      );

      const labels = await this.projectSigilLabels(params.projectId);
      let sigilIds = [...labels.keys()];
      if (query.sigilId) {
        if (!labels.has(query.sigilId)) {
          throw new NotFoundError("Sigil not found");
        }
        sigilIds = [query.sigilId];
      }

      const empty = {
        range,
        since,
        until,
        boundaries,
        minSamples: this.VITALS_PATH_MIN_SAMPLES,
        rows: [],
        hasMore: false,
        estimated: false,
      };
      if (sigilIds.length === 0) {
        return empty;
      }

      const where = this.whereFor(this.datasets.vitals.dataset, {
        sigilId: { inArray: sigilIds },
        ...this.viewFilters(query),
      });

      // Two queries, because the ranking key is not an ordering the dataset
      // can produce. The first names the busiest paths; the second reads only
      // those paths' histograms, which is what keeps a `path`-grouped read
      // bounded on the highest-cardinality dimension the dataset has.
      const busiest = await this.datasets.vitals.query({
        since,
        until,
        where,
        groupBy: ["path"],
        select: { samples: "sum" },
        orderBy: { key: "samples", direction: "desc" },
        limit: this.VITALS_PATH_CANDIDATES + 1,
      });
      const paths = busiest.rows
        .slice(0, this.VITALS_PATH_CANDIDATES)
        .map((row) => String(row.path));
      if (paths.length === 0) {
        return empty;
      }

      const histograms = await this.datasets.vitals.query({
        since,
        until,
        where: { ...where, path: { inArray: paths } },
        groupBy: ["path", "metric", "bucket"],
        select: { samples: "sum" },
      });

      // path -> metric -> bucket -> samples, which is the shape the summariser
      // already consumes, one level deeper.
      const byPath = new Map<string, AnalyticsVitalHistograms>();
      for (const row of histograms.rows) {
        const path = String(row.path);
        const metric = row.metric as VitalMetric;
        const perPath = byPath.get(path) ?? {};
        const bucket = perPath[metric] ?? new Map<number, number>();
        bucket.set(Number(row.bucket), Number(row.samples));
        perPath[metric] = bucket;
        byPath.set(path, perPath);
      }

      const rows = [...byPath.entries()].map(([path, perPath]) => {
        const summary = summariseVitals(perPath);
        let samples = 0;
        let poor = 0;
        const metrics: VitalsPathsResource["rows"][number]["metrics"] = {};
        for (const [metric, entry] of Object.entries(summary)) {
          samples += entry.samples;
          poor += this.poorSamples(metric as VitalMetric, entry.buckets);
          metrics[metric] = {
            samples: entry.samples,
            p75Lower: entry.p75Lower,
            p75Upper: entry.p75Upper,
          };
        }
        return {
          path,
          samples,
          tailShare: samples > 0 ? Math.round((poor / samples) * 100) : 0,
          confident: samples >= this.VITALS_PATH_MIN_SAMPLES,
          metrics,
        };
      });

      // Confident rows first, then worst tail first. A three-sample path
      // cannot top the list, and is still on it.
      rows.sort((a, b) => {
        if (a.confident !== b.confident) return a.confident ? -1 : 1;
        if (b.tailShare !== a.tailShare) return b.tailShare - a.tailShare;
        return b.samples - a.samples;
      });

      return {
        ...empty,
        rows: rows.slice(0, this.VITALS_PATH_ROWS),
        hasMore:
          rows.length > this.VITALS_PATH_ROWS ||
          busiest.rows.length > this.VITALS_PATH_CANDIDATES,
        estimated: histograms.estimated,
        sampleInterval: histograms.sampleInterval,
      };
    },
  });

  /**
   * Folds the legacy empty bucket into `other`, and re-sums.
   *
   * A row written before a dimension existed carries `""` on Analytics Engine:
   * a default fills a column on write, it does not rewrite rows already
   * stored. Left alone, a leaderboard over such a dimension carries a nameless
   * bucket; excluded, its shares describe less traffic than the page around it
   * claims. Both `""` and `other` mean "we cannot name this", so merging them
   * loses nothing and keeps the totals whole.
   *
   * Re-sorted after the merge, because the fold can move `other` up past a row
   * the dataset had ordered above it.
   */
  protected foldUnknown<K extends string>(
    // The dataset's own row type: every dimension comes back as a string and
    // every measure as a number, so the cast the loop would otherwise need is
    // stated once, here.
    rows: Array<Record<string, string | number>>,
    key: K,
  ): Array<Record<K, string> & { count: number }> {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const value = String(row[key] ?? "") || "other";
      totals.set(value, (totals.get(value) ?? 0) + Number(row.count));
    }
    return [...totals.entries()]
      .map(
        ([value, count]) =>
          ({ [key]: value, count }) as Record<K, string> & {
            count: number;
          },
      )
      .sort((a, b) => b.count - a.count);
  }

  /**
   * How many of a metric's samples landed in a bucket rated poor.
   *
   * From the metric's own thresholds rather than a hard-coded index, so the
   * ranking here and the colour on the card cannot disagree: both ask whether
   * the bucket's ceiling is past `poor`. The overflow bucket has no ceiling and
   * is poor by construction.
   */
  protected poorSamples(metric: VitalMetric, buckets: number[]): number {
    const bounds = VITALS_BUCKETS[metric];
    const threshold = VITALS_THRESHOLDS[metric].poor;
    let total = 0;
    buckets.forEach((count, index) => {
      const ceiling = bounds[index];
      if (ceiling === undefined || ceiling > threshold) {
        total += count;
      }
    });
    return total;
  }

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
      limit: this.TOP_ERROR_GROUPS,
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
   * The `where` terms that narrow a view query to one traffic population.
   *
   * Empty for `all`, which is what an omitted parameter means, so a caller
   * that never heard of this filter builds the same query it always did.
   *
   * Only the `views` dataset carries a `traffic` dimension, so this is never
   * spread onto a uniques or an error-group read. Both of those answer a
   * different question about a different table, and silently applying a
   * filter that one of them cannot honour would be worse than not offering
   * it.
   */
  /**
   * The value a dimension carries when the app said nothing.
   *
   * Load-bearing for one reason: a row written BEFORE a dimension existed
   * carries `""`, not the default. A default fills a column on write, it does
   * not rewrite rows already stored. So filtering `device=desktop` on the
   * plain equality would drop every view recorded before `device` was added -
   * which, on a 30-day window that straddles the deploy, looks exactly like
   * traffic collapsing on that date.
   *
   * Filtering on the default therefore matches the empty string too. Only on
   * the default: `device=mobile` must not sweep up unclassified rows, because
   * nothing ever said they were mobile. Same reasoning as
   * {@link HUMAN_TRAFFIC}, and the same shape - `AnalyticsFilter` offers
   * equality and set membership and no negation, on both backends, so the
   * positive side has to be enumerated.
   *
   * `path` and `country` are absent on purpose: neither has a default, so
   * neither has legacy rows to rescue.
   */
  protected readonly VIEW_FILTER_DEFAULTS: Record<string, string> = {
    referrer: "direct",
    campaign: "none",
    device: "desktop",
    // Both classifiers resolve ambiguity to `other`, and a row written before
    // either dimension existed carries `""`. Filtering on `other` therefore
    // has to match both, or a 30-day window straddling the deploy reads as
    // the bucket collapsing on that date.
    browser: "other",
    os: "other",
  };

  /**
   * The day bounds a request is answered over.
   *
   * Shared by both actions, because a "More" listing that resolved its window
   * a second time would be one edit away from disagreeing with the overview it
   * expands.
   *
   * `anchor` is the last day IN the window; everything counts back from it, so
   * `today` and `lastCompleteDay` differ in exactly one place. `previousWindow`
   * is the preceding window of the same width, touching this one without
   * overlapping it.
   */
  protected resolveWindow(
    range: string,
    until: "today" | "lastCompleteDay" | undefined,
  ): {
    days: number;
    anchor: Date;
    since: string;
    until: string;
    previousWindow: { since: string; until: string };
  } {
    const days = this.RANGE_DAYS[range] ?? 7;
    const anchor = new Date(this.dateTime.nowMillis());
    if (until === "lastCompleteDay") {
      anchor.setUTCDate(anchor.getUTCDate() - 1);
    }
    const sinceDate = new Date(anchor);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));

    const previousUntilDate = new Date(sinceDate);
    previousUntilDate.setUTCDate(previousUntilDate.getUTCDate() - 1);
    const previousSinceDate = new Date(previousUntilDate);
    previousSinceDate.setUTCDate(previousSinceDate.getUTCDate() - (days - 1));

    return {
      days,
      anchor,
      since: sinceDate.toISOString().slice(0, 10),
      until: anchor.toISOString().slice(0, 10),
      previousWindow: {
        since: previousSinceDate.toISOString().slice(0, 10),
        until: previousUntilDate.toISOString().slice(0, 10),
      },
    };
  }

  /**
   * The view dimensions a request narrowed by, as an `AnalyticsFilter`.
   *
   * Only keys the caller actually sent: an absent filter must be an absent
   * clause, never `undefined` spliced into a `where`.
   */
  protected viewFilters(
    query: Partial<Record<(typeof this.VIEW_FILTER_KEYS)[number], string>>,
  ): AnalyticsFilter {
    const out: AnalyticsFilter = {};
    for (const name of this.VIEW_FILTER_KEYS) {
      const value = query[name];
      if (value === undefined || value === "") {
        continue;
      }
      const fallback = this.VIEW_FILTER_DEFAULTS[name];
      out[name] =
        fallback !== undefined && value === fallback
          ? { inArray: [value, ""] }
          : value;
    }
    return out;
  }

  /**
   * The slice of a filter set one dataset can actually answer.
   *
   * Derived from the dataset's own declared dimensions rather than from a
   * list kept beside it, because the list is what goes stale. A filter naming
   * a dimension a dataset does not declare is not a wider answer, it is a
   * rejected query - which is how the Vitals tab 500'd once already, when
   * `traffic` was added to views only and one `where` was shared by both.
   */
  protected whereFor(
    dataset: AnalyticsDataset,
    filters: AnalyticsFilter,
  ): AnalyticsFilter {
    const declared = Object.keys(dataset.dimensions.shape);
    const out: AnalyticsFilter = {};
    for (const [name, value] of Object.entries(filters)) {
      if (declared.includes(name)) {
        out[name] = value;
      }
    }
    return out;
  }

  /**
   * Which of a request's filters the visitor count could not honour.
   *
   * Subtraction rather than a hard-coded list, against what
   * `LoreAnalyticsStore` says its table can narrow by - so the day a
   * dimension is added there, this shortens on its own instead of lying by
   * one entry.
   */
  protected uniqueVisitorsIgnores(filters: AnalyticsFilter): string[] {
    return Object.keys(filters).filter(
      (name) => !LoreAnalyticsStore.FILTERS.includes(name),
    );
  }

  protected trafficFilter(traffic: TrafficFilter | undefined): AnalyticsFilter {
    if (traffic === "bots") {
      return { traffic: "bot" };
    }
    if (traffic === "humans") {
      return { traffic: { inArray: this.HUMAN_TRAFFIC } };
    }
    return {};
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
    traffic: TrafficFilter | undefined,
    viewsWhere: AnalyticsFilter,
  ): Promise<NonNullable<InsightsResource["previous"]>> {
    const [uniqueVisitors, views] = await Promise.all([
      this.analytics.uniqueVisitors({ sigilIds, traffic, ...window }),
      this.datasets.views.query({
        since: window.since,
        until: window.until,
        // Literally the object the current window is measured with, passed in
        // rather than rebuilt. A delta between two windows measured on
        // different populations is not a delta, and rebuilding it here is how
        // the two drift: the dimension filters were added in one place and
        // this one kept answering about everybody.
        where: viewsWhere,
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
