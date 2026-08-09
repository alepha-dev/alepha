import { VITALS_BUCKETS, type VitalMetric } from "@alepha/sigil/vitals";
import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../entities/sigilViewsHourly.ts";
import {
  sigilVitalsHourly,
  VITALS_BUCKET_COUNT,
  vitalsBucketColumn,
} from "../entities/sigilVitalsHourly.ts";
import {
  type InsightsResource,
  insightsResourceSchema,
} from "../schemas/insightsResourceSchema.ts";
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
      //
      // Two row shapes, two halves of one number. Hash rows are counted as
      // distinct `(day, visitorHash)` pairs rather than rows, so the same
      // person visiting two of the project's apps on one day is one visitor;
      // one row per sigil would say two.
      //
      // Collapsed rows (`SigilJobs`, ~48h old and older) no longer carry
      // hashes, so all they can be is summed. That loses cross-app dedup for
      // those days and can over-count a visitor who used two apps — accepted:
      // the alternative is keeping per-visitor hashes indefinitely, and the
      // whole point of the collapse is that they stop existing.
      const [uniqueAgg] = await this.database.run(
        sql`
          SELECT
            COUNT(DISTINCT CASE
              WHEN ${this.uniques.table.visitorHash} <> ${UNIQUES_COLLAPSED_HASH}
              THEN ${this.uniques.table.day} || '|' || ${this.uniques.table.visitorHash}
            END)
            + COALESCE(SUM(CASE
              WHEN ${this.uniques.table.visitorHash} = ${UNIQUES_COLLAPSED_HASH}
              THEN ${this.uniques.table.count} ELSE 0
            END), 0) AS uniques
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
    // One read for the window, folded in memory. SQL could SUM the bucket
    // columns now that they are columns, but the fold is per metric and the row
    // count is bounded by (hour × metric × path) rather than by traffic — so a
    // GROUP BY would buy nothing and cost a second shape to keep in step with
    // the histogram walk below.
    const rows = await this.vitals.findMany({
      where: {
        sigilId: { inArray: sigilIds },
        hour: { gte: since },
      },
      columns: [
        "metric",
        ...Array.from({ length: VITALS_BUCKET_COUNT }, (_, i) =>
          vitalsBucketColumn(i),
        ),
      ],
    });

    const histograms = new Map<string, Map<number, number>>();
    for (const row of rows) {
      const histogram = histograms.get(row.metric) ?? new Map<number, number>();
      for (let index = 0; index < VITALS_BUCKET_COUNT; index++) {
        const count = row[vitalsBucketColumn(index)] ?? 0;
        if (count === 0) continue;
        histogram.set(index, (histogram.get(index) ?? 0) + count);
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
