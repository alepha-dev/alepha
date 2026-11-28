import {
  VITALS_BUCKETS,
  VITALS_THRESHOLDS,
  type VitalMetric,
} from "@alepha/lore/sigil";
import { $ownsProject } from "@lore/core/api";
import { $inject, type Infer, z } from "alepha";
import type { AnalyticsDataset, AnalyticsFilter } from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $action, BadRequestError, NotFoundError } from "alepha/server";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { projectErrors } from "../entities/projectErrors.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import {
  type InsightsDimensionResource,
  insightsDimensionResourceSchema,
} from "../schemas/insightsDimensionResourceSchema.ts";
import { insightsDimensionSchema } from "../schemas/insightsDimensionSchema.ts";
import { insightsGrainSchema } from "../schemas/insightsGrainSchema.ts";
import { insightsRangeSchema } from "../schemas/insightsRangeSchema.ts";
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
import {
  type SigilInsightsQuery,
  SigilInsightsService,
} from "../services/SigilInsightsService.ts";
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
 * `sigil_views` / `sigil_vitals` datasets declared in `DeployAnalytics`, via the
 * question-shaped `views.query(...)` / `vitals.query(...)`. The pseudo-
 * dimension `"day"` folds hour buckets into the daily timeline with no epoch
 * math on this end, the same way the old `substr(hour, 1, 10)` group did.
 * Visitors, visits and the visit rates come from `SigilInsightsService`,
 * which reads the page view log, sessions and visits as well as
 * `sigil_views`.
 *
 * **The error budget lives here too**, and also stays on the legacy path.
 * `sigil_error_groups` is the only table that keeps failures split by app, and
 * it keeps the *first* stack sample — which needs a read before every write,
 * something an append-only analytics dataset cannot do. "Is this still
 * happening over there" is a per-app question the project-wide Errors inbox
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

  /**
   * How many sigil ids may ride in one relational `IN (…)`.
   *
   * ⚠️ **D1 refuses a statement carrying more than 100 bound parameters**
   * (folio #F1173, probed: 100 ok, 101 fails), and a project-wide read binds
   * one per app. Ninety leaves room for the read's other terms - the error
   * budget adds two date bounds - and the margin is deliberate rather than
   * tuned: nothing here is faster at 98.
   *
   * ⚠️ **In-memory SQLite does not enforce the ceiling**, so a spec that
   * "passes with 101 sigils" proves nothing on its own. The cap is D1's, and
   * `InsightsController.spec.ts` asserts the SHAPE - that no chunk exceeds
   * this, and that a chunked read still answers about the whole set.
   *
   * Only the reads that hit D1 need it. `sigil_error_groups` is a
   * relational table; views, vitals and the error
   * SERIES are `$analytics()` datasets, answered in production by Analytics
   * Engine, whose provider quotes its `IN` lists as literals and binds
   * nothing. Each site says which it is where it is built.
   */
  protected readonly SIGIL_CHUNK = 90;

  protected datasets = $inject(DeployAnalytics);
  protected dateTime = $inject(DateTimeProvider);
  protected sigils = $repository(sigils);
  protected errorGroups = $repository(sigilErrorGroups);
  protected projectErrors = $repository(projectErrors);

  /**
   * What both reading actions take: a window, the population, and the
   * filters every number answers to.
   */
  protected readonly readingQuery = z.object({
    /**
     * A preset: `1d`, `7d`, `30d`, `90d` and `12mo` end today (or yesterday,
     * under `until: lastCompleteDay`); `thisMonth`, `lastMonth` and
     * `thisYear` are calendar windows. Ignored when `from` is given.
     * Omitted means `7d`.
     */
    range: insightsRangeSchema.optional(),
    /**
     * A custom window: a UTC day (`2026-11-01`, inclusive) or an ISO
     * instant. `to` is a day included, or an instant excluded; omitted, it
     * is the end of today.
     */
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    /**
     * The timeline's bucket. Omitted: hourly up to 2 days, daily up to 92,
     * monthly beyond. `week` only when asked. Hourly is refused past 7 days, and more than 30 days back.
     */
    grain: insightsGrainSchema.optional(),
    /**
     * Narrow every segment to a single enrolled app.
     */
    sigilId: z.uuid().optional(),
    until: z.enum(["today", "lastCompleteDay"]).optional(),
    /**
     * Which traffic to count. Omitted means `all`: views count everybody,
     * and visitors, visits and the visit rates are the people's
     * (`peopleOnly` on the response says so). `bots` answers views only:
     * a declared bot has no session or visit.
     */
    traffic: trafficFilterSchema.optional(),
    /**
     * Filters. Every one narrows every number: visitors and visits as well
     * as views. `entry` and `exit` are a visit's first and last page;
     * `network` is `AS<number> <name>` as stored.
     */
    path: z.string().optional(),
    country: z.string().optional(),
    referrer: z.string().optional(),
    campaign: z.string().optional(),
    device: z.string().optional(),
    browser: z.string().optional(),
    os: z.string().optional(),
    auth: z.string().optional(),
    entry: z.string().optional(),
    exit: z.string().optional(),
    network: z.string().optional(),
  });

  /**
   * How far back a window may reach: the 400 days sessions and visits are
   * kept. A compared window starting earlier answers null.
   */
  protected readonly KEPT_DAYS = 400;

  protected readonly LEADERBOARDS = [
    "path",
    "entry",
    "exit",
    "referrer",
    "campaign",
    "country",
    "device",
    "browser",
    "os",
    "auth",
    "network",
  ] as const;

  protected readonly reader = $inject(SigilInsightsService);

  getInsights = $action({
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/insights",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: this.readingQuery.extend({
        /**
         * Also read the window of the same length just before, as
         * `previous`.
         */
        compare: z.boolean().optional(),
      }),
      response: insightsResourceSchema,
    },
    handler: async ({ params, query }): Promise<InsightsResource> => {
      const traffic = query.traffic ?? "all";
      const window = this.resolveRange(query);
      const sigilIds = await this.sigilIdsFor(params.projectId, query.sigilId);
      const labels = await this.projectSigilLabels(params.projectId);
      const reading = this.readingFor(sigilIds, window, traffic, query);
      const days = window.days;
      const anchor = new Date(`${window.until}T00:00:00.000Z`);

      const [current, boards, previous, errorSeriesResult, vitalsResult] =
        await Promise.all([
          this.reader.read(reading),
          Promise.all(
            this.LEADERBOARDS.map((dimension) =>
              this.reader.leaderboard(reading, dimension, this.TOP_N),
            ),
          ),
          query.compare ? this.readPrevious(reading) : undefined,
          sigilIds.length > 0
            ? this.datasets.errors.query({
                since: window.since,
                until: window.until,
                where: { sigilId: { inArray: sigilIds } },
                groupBy: ["day", "origin"],
                select: { count: "sum" },
              })
            : undefined,
          sigilIds.length > 0
            ? this.datasets.vitals.query({
                since: window.since,
                until: window.until,
                where: this.whereFor(this.datasets.vitals.dataset, {
                  sigilId: { inArray: sigilIds },
                  ...this.viewFilters(query),
                }),
                groupBy: ["metric", "bucket"],
                select: { samples: "sum" },
              })
            : undefined,
        ]);

      const histograms: AnalyticsVitalHistograms = {};
      for (const row of vitalsResult?.rows ?? []) {
        const metric = row.metric as VitalMetric;
        const bucket = histograms[metric] ?? new Map<number, number>();
        bucket.set(Number(row.bucket), Number(row.samples));
        histograms[metric] = bucket;
      }

      const byDayOrigin = new Map<string, { client: number; server: number }>();
      for (const row of errorSeriesResult?.rows ?? []) {
        const date = String(row.day);
        const bucket = byDayOrigin.get(date) ?? { client: 0, server: 0 };
        const origin = String(row.origin);
        if (origin === "server") bucket.server += Number(row.count);
        else if (origin === "client") bucket.client += Number(row.count);
        byDayOrigin.set(date, bucket);
      }
      const errorSeries = this.zeroErrorSeries(anchor, days).map((point) => ({
        date: point.date,
        client: byDayOrigin.get(point.date)?.client ?? 0,
        server: byDayOrigin.get(point.date)?.server ?? 0,
      }));

      const errorGroups =
        sigilIds.length > 0
          ? await this.readErrorGroups(
              params.projectId,
              sigilIds,
              labels,
              window.since,
              window.until,
            )
          : [];

      const leaderboards = Object.fromEntries(
        this.LEADERBOARDS.map((dimension, index) => [
          dimension,
          boards[index].rows,
        ]),
      ) as InsightsResource["leaderboards"];

      return {
        range: window.range,
        traffic,
        from: new Date(window.from).toISOString(),
        to: new Date(window.to).toISOString(),
        grain: reading.grain,
        since: window.since,
        until: window.until,
        totals: current.totals,
        previous,
        timeline: current.timeline,
        visitorsSpanPeriods: current.visitorsSpanPeriods,
        visitorsSpanApps: current.visitorsSpanApps,
        visitorsFrom: current.visitorsFrom,
        peopleOnly: current.peopleOnly,
        leaderboards,
        vitals: summariseVitals(histograms),
        errorGroups,
        errorSeries,
        estimated: current.estimated || boards.some((board) => board.estimated),
      };
    },
  });

  getInsightsDimension = $action({
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/insights/dimensions/:dimension",
    schema: {
      params: z.object({
        projectId: z.integer(),
        dimension: insightsDimensionSchema,
      }),
      query: this.readingQuery.extend({
        /**
         * Rows to return. The overview draws ten; this exists for the view
         * that draws the rest.
         */
        limit: z.integer().min(1).max(200).optional(),
        offset: z.integer().min(0).optional(),
        /**
         * Ascending shows the tail: the pages nobody reads.
         */
        direction: z.enum(["asc", "desc"]).optional(),
      }),
      response: insightsDimensionResourceSchema,
    },
    handler: async ({ params, query }): Promise<InsightsDimensionResource> => {
      const traffic = query.traffic ?? "all";
      const limit = query.limit ?? this.DIMENSION_PAGE;
      const offset = query.offset ?? 0;
      const direction = query.direction ?? "desc";
      const window = this.resolveRange(query);
      const sigilIds = await this.sigilIdsFor(params.projectId, query.sigilId);
      const depth = offset + limit + 1;
      if (depth > this.MAX_DIMENSION_DEPTH) {
        throw new NotFoundError("Page is past the end of this leaderboard");
      }
      const reading = this.readingFor(sigilIds, window, traffic, query);
      const [board, totals] = await Promise.all([
        this.reader.leaderboard(
          reading,
          params.dimension,
          direction === "desc" ? depth : this.MAX_DIMENSION_DEPTH,
        ),
        this.reader.read(reading),
      ]);
      const ordered =
        direction === "desc" ? board.rows : board.rows.toReversed();
      const total = totals.totals.views;
      return {
        dimension: params.dimension,
        range: window.range,
        traffic,
        from: new Date(window.from).toISOString(),
        to: new Date(window.to).toISOString(),
        total,
        rows: ordered.slice(offset, offset + limit).map((row) => ({
          ...row,
          percentage: total > 0 ? Math.round((row.views / total) * 100) : 0,
        })),
        visitorsFrom: board.visitorsFrom,
        offset,
        limit,
        hasMore: ordered.length > offset + limit,
        estimated: board.estimated,
      };
    },
  });

  /**
   * The project's sigils, or the one asked for once proved to be the
   * project's: a stranger's id is a 404, not an empty window.
   */
  protected async sigilIdsFor(
    projectId: number,
    sigilId: string | undefined,
  ): Promise<string[]> {
    const labels = await this.projectSigilLabels(projectId);
    if (!sigilId) return [...labels.keys()];
    if (!labels.has(sigilId)) throw new NotFoundError("Sigil not found");
    return [sigilId];
  }

  protected readingFor(
    sigilIds: string[],
    window: { from: number; to: number },
    traffic: TrafficFilter,
    query: Infer<typeof this.readingQuery>,
  ): SigilInsightsQuery {
    const grain =
      query.grain ?? SigilInsightsService.defaultGrain(window.from, window.to);
    if (
      grain === "hour" &&
      window.to - window.from > SigilInsightsService.MAX_HOURLY_MS
    ) {
      throw new BadRequestError(
        "An hourly grain is refused beyond 7 days; ask for day, week or month.",
      );
    }
    const filters: SigilInsightsQuery["filters"] = {};
    for (const name of [
      "path",
      "country",
      "referrer",
      "campaign",
      "device",
      "browser",
      "os",
      "auth",
      "entry",
      "exit",
      "network",
    ] as const) {
      if (query[name]) filters[name] = query[name];
    }
    return {
      sigilIds,
      from: window.from,
      to: window.to,
      grain,
      traffic,
      filters,
    };
  }

  /**
   * The window of the same length just before, read the same way. Null
   * totals where it starts before the 400 days kept: nothing older is
   * there to compare with, and no retention is extended for it.
   */
  protected async readPrevious(
    reading: SigilInsightsQuery,
  ): Promise<NonNullable<InsightsResource["previous"]>> {
    const span = reading.to - reading.from;
    const window = { from: reading.from - span, to: reading.from };
    const kept = this.dateTime.nowMillis() - this.KEPT_DAYS * 86_400_000;
    const iso = {
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
    };
    if (window.from < kept) {
      return {
        ...iso,
        totals: {
          visitors: null,
          visits: null,
          views: null,
          bounceRate: null,
          engagedRate: null,
          avgVisitSeconds: null,
          pagesPerVisit: null,
        },
      };
    }
    const previous = await this.reader.read({
      ...reading,
      ...window,
      // The grain does not shape totals; a coarse one keeps the read cheap.
      grain: "month",
    });
    return { ...iso, totals: previous.totals };
  }

  /**
   * The window a request is answered over, `[from, to)` in millis, with the
   * same window as whole days for vitals and errors.
   */
  protected resolveRange(query: {
    range?: Infer<typeof insightsRangeSchema>;
    from?: string;
    to?: string;
    until?: "today" | "lastCompleteDay";
  }): {
    range: InsightsResource["range"];
    from: number;
    to: number;
    since: string;
    until: string;
    days: number;
  } {
    const DAY = 86_400_000;
    const now = this.dateTime.nowMillis();
    const today = Date.parse(
      `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    const parse = (value: string, end: boolean): number => {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
      const at = Date.parse(day ? `${value}T00:00:00.000Z` : value);
      if (Number.isNaN(at)) {
        throw new BadRequestError(
          `'${value}' is neither a UTC day (2026-11-01) nor an ISO instant.`,
        );
      }
      return day && end ? at + DAY : at;
    };

    let range: InsightsResource["range"];
    let from: number;
    let to: number;
    if (query.from) {
      range = "custom";
      from = parse(query.from, false);
      to = query.to ? parse(query.to, true) : today + DAY;
    } else {
      range = query.range ?? "7d";
      const end = query.until === "lastCompleteDay" ? today : today + DAY;
      const date = new Date(today);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const rolling: Record<string, number> = {
        "1d": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "12mo": 365,
      };
      if (range === "thisMonth") {
        from = Date.UTC(year, month, 1);
        to = today + DAY;
      } else if (range === "lastMonth") {
        from = Date.UTC(year, month - 1, 1);
        to = Date.UTC(year, month, 1);
      } else if (range === "thisYear") {
        from = Date.UTC(year, 0, 1);
        to = today + DAY;
      } else {
        to = end;
        from = end - rolling[range] * DAY;
      }
    }
    // Nothing is recorded past today: a later end would only add empty
    // buckets, and an unbounded one would make the timeline unbounded too.
    to = Math.min(to, today + DAY);
    if (!(from < to)) {
      throw new BadRequestError("A window must end after it starts.");
    }
    if (from < now - this.KEPT_DAYS * DAY - DAY) {
      throw new BadRequestError(
        `A window reaches back ${this.KEPT_DAYS} days at most.`,
      );
    }
    const since = new Date(from).toISOString().slice(0, 10);
    const until = new Date(to - 1).toISOString().slice(0, 10);
    const days =
      Math.round(
        (Date.parse(`${until}T00:00:00.000Z`) -
          Date.parse(`${since}T00:00:00.000Z`)) /
          DAY,
      ) + 1;
    return { range, from, to, since, until, days };
  }

  getVitalsPaths = $action({
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
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

      // ⚠️ `$analytics()` vitals, not D1 — same reasoning as the two above.
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
   * full timestamp, so the bound is the NEXT day, exclusive:
   * `2026-08-20T23:59` is in and `2026-08-21T00:00` is out. `<= "2026-08-20"`
   * would exclude the whole day it names. It was the day plus a `~` sentinel,
   * which holds in byte order (SQLite) and not under Postgres's linguistic
   * collation, where `~` does not sort after the letters and digits.
   */
  protected async readErrorGroups(
    projectId: number,
    sigilIds: string[],
    labels: Map<string, string>,
    since: string,
    until: string,
  ): Promise<InsightsResource["errorGroups"]> {
    // ⚠️ D1, and one bound parameter per app — see `SIGIL_CHUNK`. Chunked
    // rather than scoped by a `projectId` subquery because the repository's
    // where-filter has no way to express one: `FilterOperators` offers value
    // comparisons and set membership, and nothing that takes a SELECT.
    //
    // The merge is where a chunked leaderboard goes wrong, so it is done
    // BEFORE the slice: each chunk returns its own top twenty, and the top
    // twenty overall are then taken from the union. Taking twenty per chunk is
    // what makes that sound — a row in the global top twenty has at most
    // nineteen rows above it anywhere, so it cannot be pushed out of its own
    // chunk's twenty. Slicing each chunk to a share of twenty would drop real
    // rows the moment a project's errors clustered in one app.
    //
    // With one chunk this is the query it has always been, in the order the
    // database returned it: `sort` is stable, so equal counts keep it.
    const pages = await Promise.all(
      this.chunked(sigilIds).map((ids) =>
        this.errorGroups.findMany({
          where: {
            sigilId: { inArray: ids },
            lastSeenAt: {
              gte: since,
              lt: this.dateTime.utc(until).add(1, "day").format("YYYY-MM-DD"),
            },
          },
          orderBy: [{ column: "count", direction: "desc" }],
          limit: this.TOP_ERROR_GROUPS,
        }),
      ),
    );
    const rows = pages
      .flat()
      .sort((left, right) => (right.count ?? 1) - (left.count ?? 1))
      .slice(0, this.TOP_ERROR_GROUPS);

    // The project's error each group belongs to (#E185), so a row opens its
    // page: one statement for the whole list, bounded by `TOP_ERROR_GROUPS`,
    // and none for an app that reported nothing.
    const fingerprints = [...new Set(rows.map((row) => row.fingerprint))];
    const errors = fingerprints.length
      ? await this.projectErrors.findMany({
          where: {
            projectId: { eq: projectId },
            fingerprint: { inArray: fingerprints },
          },
          columns: ["id", "fingerprint"],
        })
      : [];
    const errorIds = new Map(errors.map((it) => [it.fingerprint, it.id]));

    return rows.map((row) => ({
      ...(errorIds.has(row.fingerprint)
        ? { errorId: errorIds.get(row.fingerprint) }
        : {}),
      sigilId: row.sigilId,
      // The sigil is guaranteed present — the ids came from the same read, and
      // `sigil_error_groups.sigilId` cascades on delete.
      sigilLabel: labels.get(row.sigilId) ?? row.sigilId,
      fingerprint: row.fingerprint,
      name: row.name,
      message: row.message,
      origin: row.origin,
      count: row.count ?? 1,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }));
  }

  /**
   * The sigil ids, cut into lists a relational statement can bind.
   *
   * No chunks at all for an empty list, which is what makes the caller's
   * `Promise.all` answer "no rows" rather than ask a question it cannot
   * phrase: `{ inArray: [] }` is an `AlephaError` from the repository, not an
   * empty result. Every read that reaches here has already returned early on
   * an empty app set, so this is a guard against the next caller, not this
   * one.
   */
  protected chunked(sigilIds: string[]): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < sigilIds.length; index += this.SIGIL_CHUNK) {
      chunks.push(sigilIds.slice(index, index + this.SIGIL_CHUNK));
    }
    return chunks;
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
   * The slice of a filter set one dataset can actually answer.
   *
   * Derived from the dataset's own declared dimensions rather than from a
   * list kept beside it, because the list is what goes stale. A filter naming
   * a dimension a dataset does not declare is not a wider answer, it is a
   * rejected query - which is how the Vitals tab 500'd once already.
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
   * The window's calendar with both origins at zero.
   *
   * The same reasoning as `zeroTimeline`, and the same reason it is not
   * folded into it: a chart that skips the days with no rows draws a
   * quiet week as a shorter week.
   */
  protected zeroErrorSeries(
    anchor: Date,
    days: number,
  ): Array<{ date: string; client: number; server: number }> {
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(anchor);
      day.setUTCDate(day.getUTCDate() - (days - 1 - index));
      return { date: day.toISOString().slice(0, 10), client: 0, server: 0 };
    });
  }
}
