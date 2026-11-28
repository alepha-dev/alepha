import { $inject, AlephaError, z } from "alepha";
import {
  type AnalyticsFilter,
  EventLogPlan,
  type EventLogGrain,
} from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, type SQL, sql } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { sigilSessions } from "../entities/sigilSessions.ts";
import { sigilVisits } from "../entities/sigilVisits.ts";
import type { TrafficFilter } from "../schemas/trafficFilterSchema.ts";

/**
 * The filters every number answers to. `entry` and `exit` are a visit's
 * first and last page; `network` is `AS13335 Name` as stored.
 */
export interface SigilInsightsFilters {
  path?: string;
  country?: string;
  referrer?: string;
  campaign?: string;
  device?: string;
  browser?: string;
  os?: string;
  auth?: string;
  entry?: string;
  exit?: string;
  network?: string;
}

export interface SigilInsightsQuery {
  sigilIds: string[];
  /**
   * `[from, to)`, UTC millis.
   */
  from: number;
  to: number;
  grain: EventLogGrain;
  traffic: TrafficFilter;
  filters: SigilInsightsFilters;
}

export interface SigilInsightsTotals {
  visitors: number | null;
  visits: number | null;
  views: number;
  /**
   * Shares in `[0, 1]`: visits with exactly one view, and engaged visits.
   */
  bounceRate: number | null;
  engagedRate: number | null;
  avgVisitSeconds: number | null;
  pagesPerVisit: number | null;
}

export interface SigilInsightsBucket {
  /**
   * The bucket's key at the grain: `YYYY-MM-DDTHH`, `YYYY-MM-DD` (a day,
   * or a week's Monday) or `YYYY-MM`.
   */
  bucket: string;
  visitors: number | null;
  visits: number | null;
  views: number;
}

export interface SigilInsightsReading {
  totals: SigilInsightsTotals;
  timeline: SigilInsightsBucket[];
  /**
   * The visitor count adds up several periods of one app (a range crossing
   * a month, or an app hashing daily).
   */
  visitorsSpanPeriods: boolean;
  /**
   * The visitor count adds up several apps: one person on two apps is two
   * visitors, always.
   */
  visitorsSpanApps: boolean;
  /**
   * The day visitors and visits are counted from, when later than the
   * range's start: before v2's first day there are none, and under a path
   * filter none older than the page view log.
   */
  visitorsFrom: string | null;
  /**
   * Visitors, visits and the visit rates are the people's while views also
   * count declared bots: the `all` reading.
   */
  peopleOnly: boolean;
  /**
   * A share of the views was read from `sigil_views` on a backend that
   * samples.
   */
  estimated: boolean;
}

export type SigilInsightsDimension =
  | "path"
  | "entry"
  | "exit"
  | "referrer"
  | "campaign"
  | "country"
  | "device"
  | "browser"
  | "os"
  | "auth"
  | "network";

export interface SigilInsightsLeaderboard {
  rows: Array<{ value: string; visitors: number | null; views: number }>;
  visitorsFrom: string | null;
  estimated: boolean;
}

type Window = { from: number; to: number };

/**
 * Visitors, visits, views, bounce and duration over any range and grain,
 * for a set of apps, from the stores v2 writes.
 *
 * **Where each number comes from** (people; bots below):
 *
 * - Inside the page view log's 90 days: visitors (distinct sessions),
 *   visits (distinct visits) and views from the log, under every filter.
 * - A range reaching older than the log: visitors and visits from
 *   `sigil_visits` over the whole range, so a session seen on both sides of
 *   the line is still one visitor; views from the log for the days it holds
 *   and from `sigil_visits` view counts before, each day read once. Under a
 *   path filter, visitors and visits are only counted inside the log
 *   (`visitorsFrom`), and older views come from `sigil_views`.
 * - Bounce, engaged rate, duration and pages per visit: `sigil_visits`,
 *   always; under a path filter, of the visits that entered on it.
 * - Under an `entry` or `exit` filter, everything is read from
 *   `sigil_visits`: those are a visit's properties.
 * - Before v2's first day (the first session of these apps): `sigil_views`,
 *   views only.
 *
 * **Bots.** A declared bot has no session, visit or log row, so `bots` reads
 * `sigil_views` alone and answers views only, everything else null; `all`
 * adds those bot views to the people's views and says so (`peopleOnly`).
 *
 * **Several apps.** Every count here adds up per app, which is now exact:
 * one person on two apps is two hashes. That is also what lets every read
 * be cut into chunks of apps for D1's 100 bound parameters.
 */
export class SigilInsightsService {
  /**
   * How far back the page view log reaches, in whole UTC days counted back
   * from today; one day short of its 90 day keep, so a day read from the log
   * is always whole.
   */
  public static readonly LOG_DAYS = 89;

  /**
   * Apps per relational statement, under D1's 100 bound parameters with
   * room for the window and the filters.
   */
  protected readonly SIGIL_CHUNK = 80;

  /**
   * An hourly grain is refused beyond a week: that many buckets is a chart
   * nobody reads, and `sigil_views` keeps hours for 30 days only.
   */
  public static readonly MAX_HOURLY_MS = 7 * 86_400_000;

  /**
   * How far back an hourly grain may start: `sigil_views` keeps hours for
   * its 30 hot days, then days only.
   */
  public static readonly HOURLY_KEPT_MS = 30 * 86_400_000;

  /**
   * Most buckets one reading answers, whatever the grain: a timeline is
   * built in memory, bucket by bucket.
   */
  public static readonly MAX_BUCKETS = 1_000;

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly datasets = $inject(DeployAnalytics);
  protected readonly sessions = $repository(sigilSessions);
  protected readonly visits = $repository(sigilVisits);

  /**
   * The grain a range reads at when none is asked: hourly up to 2 days,
   * daily up to 92, monthly beyond.
   */
  public static defaultGrain(from: number, to: number): EventLogGrain {
    const span = to - from;
    if (span <= 2 * 86_400_000) return "hour";
    if (span <= 92 * 86_400_000) return "day";
    return "month";
  }

  /**
   * The first instant the page view log answers for.
   */
  public logStart(): number {
    const today = Date.parse(
      `${new Date(this.dateTime.nowMillis()).toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    return today - SigilInsightsService.LOG_DAYS * 86_400_000;
  }

  /**
   * Totals and the timeline.
   */
  public async read(query: SigilInsightsQuery): Promise<SigilInsightsReading> {
    this.assertQuery(query);
    const buckets = this.zeroBuckets(query);
    const peopleOnly = query.traffic === "all";
    const reading: SigilInsightsReading = {
      totals: {
        visitors: null,
        visits: null,
        views: 0,
        bounceRate: null,
        engagedRate: null,
        avgVisitSeconds: null,
        pagesPerVisit: null,
      },
      timeline: [],
      visitorsSpanPeriods: false,
      visitorsSpanApps: query.sigilIds.length > 1,
      visitorsFrom: null,
      peopleOnly,
      estimated: false,
    };
    if (query.sigilIds.length === 0) {
      reading.timeline = [...buckets.values()];
      return reading;
    }

    if (query.traffic !== "bots") {
      await this.readPeople(query, buckets, reading);
    }
    if (query.traffic !== "humans") {
      const bots = await this.readSigilViews(query, query, "bot");
      reading.totals.views += bots.total;
      reading.estimated ||= bots.estimated;
      for (const [key, views] of bots.byBucket) {
        const bucket = buckets.get(key);
        if (bucket) bucket.views += views;
      }
    }

    reading.timeline = [...buckets.values()];
    return reading;
  }

  /**
   * One dimension's leaderboard: visitors and views per value, ranked by
   * visitors then views.
   */
  public async leaderboard(
    query: SigilInsightsQuery,
    dimension: SigilInsightsDimension,
    limit: number,
  ): Promise<SigilInsightsLeaderboard> {
    this.assertQuery(query);
    const values = new Map<
      string,
      { visitors: number | null; views: number }
    >();
    const out: SigilInsightsLeaderboard = {
      rows: [],
      visitorsFrom: null,
      estimated: false,
    };
    if (query.sigilIds.length === 0) return out;
    const add = (value: string, visitors: number | null, views: number) => {
      const row = values.get(value) ?? { visitors: null, views: 0 };
      if (visitors !== null) row.visitors = (row.visitors ?? 0) + visitors;
      row.views += views;
      values.set(value, row);
    };

    if (query.traffic !== "bots") {
      const plan = await this.plan(query);
      out.visitorsFrom = plan.visitorsFrom;
      if (plan.preV2) {
        const pre = await this.groupSigilViews(
          query,
          plan.preV2,
          "human",
          dimension,
        );
        out.estimated ||= pre.estimated;
        for (const row of pre.rows) add(row.value, null, row.views);
      }
      if (plan.people) {
        const people = plan.people;
        const visitDimension = dimension === "entry" || dimension === "exit";
        // Under a path filter, a visit only knows its entry page: past the
        // log, the page's other dimensions read the log and `sigil_views`.
        const pathPastLog =
          !plan.inLog && (dimension === "path" || !!query.filters.path);
        const byVisits =
          visitDimension || plan.visitsOnly || (!plan.inLog && !pathPastLog);
        if (byVisits) {
          for (const row of await this.groupVisits(query, people, dimension)) {
            add(row.value, row.visitors, row.views);
          }
        } else if (pathPastLog) {
          // Older than the log, a page's visitors are not known: views only.
          const logPart = {
            from: Math.max(people.from, plan.logStart),
            to: people.to,
          };
          if (logPart.from < logPart.to) {
            for (const row of await this.groupLog(query, logPart, dimension)) {
              add(row.value, row.visitors, row.views);
            }
          }
          const older = {
            from: people.from,
            to: Math.min(people.to, plan.logStart),
          };
          const views = await this.groupSigilViews(
            query,
            older,
            "human",
            dimension,
          );
          out.estimated ||= views.estimated;
          for (const row of views.rows) add(row.value, null, row.views);
        } else {
          for (const row of await this.groupLog(query, people, dimension)) {
            add(row.value, row.visitors, row.views);
          }
        }
      }
    }
    if (query.traffic !== "humans") {
      const bots = await this.groupSigilViews(query, query, "bot", dimension);
      out.estimated ||= bots.estimated;
      for (const row of bots.rows) add(row.value, null, row.views);
    }

    out.rows = [...values.entries()]
      .map(([value, row]) => ({ value, ...row }))
      .sort(
        (a, b) =>
          (b.visitors ?? -1) - (a.visitors ?? -1) ||
          b.views - a.views ||
          a.value.localeCompare(b.value),
      )
      .slice(0, limit);
    return out;
  }

  // -------------------------------------------------------------------------
  // planning

  /**
   * Which store answers which part of the range.
   */
  protected async plan(query: SigilInsightsQuery): Promise<{
    /**
     * The part of the range v2 has data for, or none.
     */
    people?: Window;
    /**
     * The part before v2's first session, views only.
     */
    preV2?: Window;
    inLog: boolean;
    logStart: number;
    visitsOnly: boolean;
    visitorsFrom: string | null;
  }> {
    const logStart = this.logStart();
    const v2 = await this.v2Start(query.sigilIds);
    // Day-aligned: `sigil_views` keeps days past its 30 hot days and reads a
    // straddling day whole, so a pre-v2 window ending mid-day would count
    // that day's views a second time. v2's numbers start on its first day.
    const peopleFrom =
      v2 === undefined ? query.to : Math.max(query.from, this.floorDay(v2));
    const people =
      peopleFrom < query.to ? { from: peopleFrom, to: query.to } : undefined;
    const preV2 =
      query.from < Math.min(peopleFrom, query.to)
        ? { from: query.from, to: Math.min(peopleFrom, query.to) }
        : undefined;
    const inLog = people !== undefined && people.from >= logStart;
    const visitsOnly = !!(query.filters.entry || query.filters.exit);

    // The day visitors start being counted, when later than the range's
    // start: v2's first day, or under a path filter the log's first.
    let countedFrom = people?.from;
    if (people && query.filters.path && !inLog && !visitsOnly) {
      countedFrom = logStart;
    }
    const visitorsFrom =
      countedFrom !== undefined && countedFrom > query.from
        ? new Date(countedFrom).toISOString().slice(0, 10)
        : null;
    return { people, preV2, inLog, logStart, visitsOnly, visitorsFrom };
  }

  protected async readPeople(
    query: SigilInsightsQuery,
    buckets: Map<string, SigilInsightsBucket>,
    reading: SigilInsightsReading,
  ): Promise<void> {
    const plan = await this.plan(query);
    reading.visitorsFrom = plan.visitorsFrom;

    if (plan.preV2) {
      const pre = await this.readSigilViews(query, plan.preV2, "human");
      reading.totals.views += pre.total;
      reading.estimated ||= pre.estimated;
      for (const [key, views] of pre.byBucket) {
        const bucket = buckets.get(key);
        if (bucket) bucket.views += views;
      }
    }
    const people = plan.people;
    if (!people) return;

    // From here on, every bucket the people's part touches counts visitors.
    const counted = (window: Window) => {
      for (const bucket of buckets.values()) {
        const start = this.bucketStart(bucket.bucket, query.grain);
        if (
          start < window.to &&
          this.bucketEnd(start, query.grain) > window.from
        ) {
          bucket.visitors ??= 0;
          bucket.visits ??= 0;
        }
      }
    };

    const [visitStats, spans] = await Promise.all([
      this.aggregateVisits(query, people),
      this.spansPeriods(query.sigilIds, people),
    ]);
    reading.visitorsSpanPeriods = spans;
    const stats = visitStats.total;
    // No visit, no rate: null rather than a 0% bounce nobody had.
    if (stats.visits > 0) {
      reading.totals.bounceRate = stats.bounces / stats.visits;
      reading.totals.engagedRate = stats.engaged / stats.visits;
      reading.totals.avgVisitSeconds = stats.duration / stats.visits;
      reading.totals.pagesPerVisit = stats.views / stats.visits;
    }

    if (plan.visitsOnly) {
      // Entry and exit are a visit's: everything from the visits.
      counted(people);
      const byBucket = await this.visitsByBucket(query, people);
      reading.totals.visitors = visitStats.headline.visitors;
      reading.totals.visits = visitStats.headline.visits;
      reading.totals.views += visitStats.headline.views;
      for (const [key, row] of byBucket) this.addBucket(buckets, key, row);
      return;
    }

    if (plan.inLog) {
      counted(people);
      const log = await this.readLog(query, people);
      reading.totals.visitors = log.total.visitors;
      reading.totals.visits = log.total.visits;
      reading.totals.views += log.total.views;
      for (const [key, row] of log.byBucket) this.addBucket(buckets, key, row);
      return;
    }

    const logPart: Window = {
      from: Math.max(people.from, plan.logStart),
      to: people.to,
    };
    const older: Window = {
      from: people.from,
      to: Math.min(people.to, plan.logStart),
    };

    if (query.filters.path) {
      // A page's visitors are only known inside the log; its older views
      // come from `sigil_views`.
      if (logPart.from < logPart.to) {
        counted(logPart);
        const log = await this.readLog(query, logPart);
        reading.totals.visitors = log.total.visitors;
        reading.totals.visits = log.total.visits;
        reading.totals.views += log.total.views;
        for (const [key, row] of log.byBucket)
          this.addBucket(buckets, key, row);
      }
      const views = await this.readSigilViews(query, older, "human");
      reading.totals.views += views.total;
      reading.estimated ||= views.estimated;
      for (const [key, count] of views.byBucket) {
        const bucket = buckets.get(key);
        if (bucket) bucket.views += count;
      }
      return;
    }

    // Visitors and visits over the whole part from the visits, so a session
    // on both sides of the line is one visitor; views spliced by day.
    counted(people);
    reading.totals.visitors = visitStats.headline.visitors;
    reading.totals.visits = visitStats.headline.visits;
    const visitBuckets = await this.visitsByBucket(query, people);
    for (const [key, row] of visitBuckets) {
      this.addBucket(buckets, key, { ...row, views: 0 });
    }
    if (older.from < older.to) {
      const oldViews = await this.visitsByBucket(query, older);
      for (const [key, row] of oldViews) {
        this.addBucket(buckets, key, {
          visitors: 0,
          visits: 0,
          views: row.views,
        });
        reading.totals.views += row.views;
      }
    }
    if (logPart.from < logPart.to) {
      const log = await this.readLog(query, logPart);
      reading.totals.views += log.total.views;
      for (const [key, row] of log.byBucket) {
        this.addBucket(buckets, key, {
          visitors: 0,
          visits: 0,
          views: row.views,
        });
      }
    }
  }

  protected addBucket(
    buckets: Map<string, SigilInsightsBucket>,
    key: string,
    row: { visitors: number; visits: number; views: number },
  ): void {
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.visitors = (bucket.visitors ?? 0) + row.visitors;
    bucket.visits = (bucket.visits ?? 0) + row.visits;
    bucket.views += row.views;
  }

  // -------------------------------------------------------------------------
  // the page view log

  protected logWhere(query: SigilInsightsQuery): AnalyticsFilter {
    const where: AnalyticsFilter = { sigilId: { inArray: query.sigilIds } };
    for (const name of [
      "path",
      "country",
      "referrer",
      "campaign",
      "device",
      "browser",
      "os",
      "auth",
      "network",
    ] as const) {
      const value = query.filters[name];
      if (value) where[name] = value;
    }
    return where;
  }

  protected instant(millis: number): string {
    return new Date(millis).toISOString();
  }

  protected async readLog(
    query: SigilInsightsQuery,
    window: Window,
  ): Promise<{
    total: { visitors: number; visits: number; views: number };
    byBucket: Map<string, { visitors: number; visits: number; views: number }>;
  }> {
    const select = {
      visitors: { distinct: "sessionId" },
      visits: { distinct: "visitId" },
      views: { sum: "views" },
    } as const;
    const base = {
      from: this.instant(window.from),
      to: this.instant(window.to),
      where: this.logWhere(query),
      select,
    };
    const [total, timeline] = await Promise.all([
      this.datasets.pageviews.query(base),
      this.datasets.pageviews.query({ ...base, groupBy: [query.grain] }),
    ]);
    const row = total.rows[0] ?? {};
    const byBucket = new Map<
      string,
      { visitors: number; visits: number; views: number }
    >();
    for (const it of timeline.rows) {
      byBucket.set(String(it[query.grain]), {
        visitors: Number(it.visitors ?? 0),
        visits: Number(it.visits ?? 0),
        views: Number(it.views ?? 0),
      });
    }
    return {
      total: {
        visitors: Number(row.visitors ?? 0),
        visits: Number(row.visits ?? 0),
        views: Number(row.views ?? 0),
      },
      byBucket,
    };
  }

  protected async groupLog(
    query: SigilInsightsQuery,
    window: Window,
    dimension: SigilInsightsDimension,
  ): Promise<Array<{ value: string; visitors: number; views: number }>> {
    const result = await this.datasets.pageviews.query({
      from: this.instant(window.from),
      to: this.instant(window.to),
      where: this.logWhere(query),
      groupBy: [dimension],
      select: { visitors: { distinct: "sessionId" }, views: { sum: "views" } },
    });
    return result.rows
      .filter((row) => row[dimension] !== null && row[dimension] !== undefined)
      .map((row) => ({
        value: String(row[dimension]),
        visitors: Number(row.visitors ?? 0),
        views: Number(row.views ?? 0),
      }));
  }

  // -------------------------------------------------------------------------
  // sigil_visits

  /**
   * The `sigil_visits` column a filter or a dimension reads. A path filter
   * reads the entry path: bounce and duration are those of visits that
   * entered on the page.
   */
  protected visitColumn(name: keyof SigilInsightsFilters): SQL {
    const t = this.visits.table;
    const columns: Record<keyof SigilInsightsFilters, unknown> = {
      path: t.entryPath,
      entry: t.entryPath,
      exit: t.exitPath,
      country: t.country,
      referrer: t.referrer,
      campaign: t.campaign,
      device: t.device,
      browser: t.browser,
      os: t.os,
      auth: t.auth,
      network: t.network,
    };
    return sql`${columns[name]}`;
  }

  protected visitConditions(
    query: SigilInsightsQuery,
    sigilIds: string[],
    window: Window,
    options: { ignorePath?: boolean } = {},
  ): SQL {
    const t = this.visits.table;
    const conditions: SQL[] = [
      sql`${t.sigilId} IN (${sql.join(
        sigilIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
      sql`${t.startedAt} >= ${this.instant(window.from)}`,
      sql`${t.startedAt} < ${this.instant(window.to)}`,
    ];
    for (const [name, value] of Object.entries(query.filters)) {
      if (!value) continue;
      if (name === "path" && options.ignorePath) continue;
      conditions.push(
        sql`${this.visitColumn(name as keyof SigilInsightsFilters)} = ${value}`,
      );
    }
    return sql.join(conditions, sql` AND `);
  }

  protected durationExpression(): SQL {
    const t = this.visits.table;
    if (this.database.dialect === "postgresql") {
      return sql`EXTRACT(EPOCH FROM (${t.lastSeenAt}::timestamptz - ${t.startedAt}::timestamptz))`;
    }
    return sql`(julianday(${t.lastSeenAt}) - julianday(${t.startedAt})) * 86400.0`;
  }

  /**
   * The UTC grain key of a visit's start, matching `EventLogPlan.bucket`.
   */
  protected visitGrain(grain: EventLogGrain): SQL {
    const started = sql`${this.visits.table.startedAt}`;
    if (grain === "hour") return sql`substr(${started}, 1, 13)`;
    if (grain === "day") return sql`substr(${started}, 1, 10)`;
    if (grain === "month") return sql`substr(${started}, 1, 7)`;
    if (this.database.dialect === "postgresql") {
      return sql`to_char(date_trunc('week', (${started})::timestamp), 'YYYY-MM-DD')`;
    }
    return sql`date(substr(${started}, 1, 10), 'weekday 0', '-6 days')`;
  }

  /**
   * Counts over `sigil_visits`, per group, added up over chunks of apps.
   */
  protected async visitRows(
    query: SigilInsightsQuery,
    window: Window,
    group: SQL | undefined,
    options: { ignorePath?: boolean } = {},
  ): Promise<
    Array<{
      key: string | null;
      visitors: number;
      visits: number;
      views: number;
      bounces: number;
      engaged: number;
      duration: number;
    }>
  > {
    if (window.from >= window.to) return [];
    const t = this.visits.table;
    const n = z.union([z.null(), z.coerce.number()]);
    const shape = z.object({
      key: z.union([z.null(), z.coerce.string()]),
      visitors: n,
      visits: n,
      views: n,
      bounces: n,
      engaged: n,
      duration: n,
    });
    const merged = new Map<
      string,
      {
        key: string | null;
        visitors: number;
        visits: number;
        views: number;
        bounces: number;
        engaged: number;
        duration: number;
      }
    >();
    for (const chunk of this.chunked(query.sigilIds)) {
      const rows = await this.database.run(
        sql`SELECT ${group ?? sql`NULL`} AS key,
          COUNT(DISTINCT ${t.sessionId}) AS visitors,
          COUNT(*) AS visits,
          SUM(${t.views}) AS views,
          SUM(CASE WHEN ${t.views} = 1 THEN 1 ELSE 0 END) AS bounces,
          SUM(CASE WHEN ${t.engaged} THEN 1 ELSE 0 END) AS engaged,
          SUM(${this.durationExpression()}) AS duration
        FROM ${t}
        WHERE ${this.visitConditions(query, chunk, window, options)}
        ${group ? sql`GROUP BY ${group}` : sql``}`,
        shape,
      );
      for (const row of rows) {
        if (!group && Number(row.visits ?? 0) === 0) continue;
        const id = String(row.key);
        const it = merged.get(id) ?? {
          key: row.key,
          visitors: 0,
          visits: 0,
          views: 0,
          bounces: 0,
          engaged: 0,
          duration: 0,
        };
        it.visitors += Number(row.visitors ?? 0);
        it.visits += Number(row.visits ?? 0);
        it.views += Number(row.views ?? 0);
        it.bounces += Number(row.bounces ?? 0);
        it.engaged += Number(row.engaged ?? 0);
        it.duration += Number(row.duration ?? 0);
        merged.set(id, it);
      }
    }
    return [...merged.values()];
  }

  /**
   * The visit rates (of visits entered on the path, under a path filter)
   * and the visitors, visits and views the visits count under the other
   * filters (no path: a visit's own pages are not on it).
   */
  protected async aggregateVisits(
    query: SigilInsightsQuery,
    window: Window,
  ): Promise<{
    total: {
      visits: number;
      views: number;
      bounces: number;
      engaged: number;
      duration: number;
    };
    headline: { visitors: number; visits: number; views: number };
  }> {
    const empty = {
      visitors: 0,
      visits: 0,
      views: 0,
      bounces: 0,
      engaged: 0,
      duration: 0,
    };
    const [rates] = await this.visitRows(query, window, undefined);
    const [headline] = query.filters.path
      ? await this.visitRows(query, window, undefined, { ignorePath: true })
      : [rates];
    return {
      total: rates ?? empty,
      headline: headline ?? empty,
    };
  }

  protected async visitsByBucket(
    query: SigilInsightsQuery,
    window: Window,
  ): Promise<Map<string, { visitors: number; visits: number; views: number }>> {
    const rows = await this.visitRows(
      query,
      window,
      this.visitGrain(query.grain),
    );
    return new Map(
      rows.map((row) => [
        String(row.key),
        { visitors: row.visitors, visits: row.visits, views: row.views },
      ]),
    );
  }

  protected async groupVisits(
    query: SigilInsightsQuery,
    window: Window,
    dimension: SigilInsightsDimension,
  ): Promise<Array<{ value: string; visitors: number; views: number }>> {
    const rows = await this.visitRows(
      query,
      window,
      this.visitColumn(dimension),
    );
    return rows
      .filter((row) => row.key !== null)
      .map((row) => ({
        value: String(row.key),
        visitors: row.visitors,
        views: row.views,
      }));
  }

  // -------------------------------------------------------------------------
  // sessions

  /**
   * v2's first instant for these apps: their first session's first event.
   */
  protected async v2Start(sigilIds: string[]): Promise<number | undefined> {
    const t = this.sessions.table;
    let first: string | undefined;
    for (const chunk of this.chunked(sigilIds)) {
      const [row] = await this.database.run(
        sql`SELECT MIN(${t.firstSeenAt}) AS first FROM ${t} WHERE ${t.sigilId} IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
        z.object({ first: z.string().nullable() }),
      );
      if (row?.first && (!first || row.first < first)) first = row.first;
    }
    return first ? Date.parse(first) : undefined;
  }

  /**
   * Whether one app holds sessions of more than one period in the window:
   * its visitor count is then a sum of periods.
   */
  protected async spansPeriods(
    sigilIds: string[],
    window: Window,
  ): Promise<boolean> {
    const t = this.sessions.table;
    for (const chunk of this.chunked(sigilIds)) {
      const rows = await this.database.run(
        sql`SELECT ${t.sigilId} AS id FROM ${t}
          WHERE ${t.sigilId} IN (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})
          AND ${t.lastSeenAt} >= ${this.instant(window.from)}
          AND ${t.firstSeenAt} < ${this.instant(window.to)}
          GROUP BY ${t.sigilId}
          HAVING COUNT(DISTINCT ${t.period}) > 1
          LIMIT 1`,
        z.object({ id: z.string() }),
      );
      if (rows.length > 0) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // sigil_views

  /**
   * The `sigil_views` filter for a population and the query's filters, or
   * `undefined` when a filter names something `sigil_views` does not hold
   * (entry, exit, network): no view there matches it.
   */
  protected sigilViewsWhere(
    query: SigilInsightsQuery,
    sigilIds: string[],
    traffic: "human" | "bot",
  ): AnalyticsFilter | undefined {
    const { entry, exit, network, ...rest } = query.filters;
    if (entry || exit || network) return undefined;
    const where: AnalyticsFilter = {
      sigilId: { inArray: sigilIds },
      traffic: traffic === "bot" ? "bot" : { inArray: ["human", ""] },
    };
    for (const [name, value] of Object.entries(rest)) {
      if (value) where[name] = value;
    }
    return where;
  }

  /**
   * Views in a window from `sigil_views`, by bucket at the query's grain
   * (read by hour or by day, folded into weeks and months here).
   */
  protected async readSigilViews(
    query: SigilInsightsQuery,
    window: Window,
    traffic: "human" | "bot",
  ): Promise<{
    total: number;
    byBucket: Map<string, number>;
    estimated: boolean;
  }> {
    const byBucket = new Map<string, number>();
    let total = 0;
    let estimated = false;
    if (window.from >= window.to) return { total, byBucket, estimated };
    const read = query.grain === "hour" ? "hour" : "day";
    for (const chunk of this.chunked(query.sigilIds)) {
      const where = this.sigilViewsWhere(query, chunk, traffic);
      if (!where) break;
      const result = await this.datasets.views.query({
        from: this.instant(window.from),
        to: this.instant(window.to),
        where,
        groupBy: [read],
        select: { count: "sum" },
      });
      estimated ||= result.estimated;
      for (const row of result.rows) {
        const key = String(row[read]);
        const start =
          read === "hour"
            ? Date.parse(`${key}:00:00.000Z`)
            : Date.parse(`${key}T00:00:00.000Z`);
        const bucket = EventLogPlan.bucket(start, query.grain);
        const count = Number(row.count ?? 0);
        byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + count);
        total += count;
      }
    }
    return { total, byBucket, estimated };
  }

  protected async groupSigilViews(
    query: SigilInsightsQuery,
    window: Window,
    traffic: "human" | "bot",
    dimension: SigilInsightsDimension,
  ): Promise<{
    rows: Array<{ value: string; views: number }>;
    estimated: boolean;
  }> {
    const rows = new Map<string, number>();
    let estimated = false;
    // A bot's landing page is its entry; exit and network are not recorded.
    const column = dimension === "entry" ? "path" : dimension;
    if (
      window.from >= window.to ||
      dimension === "exit" ||
      dimension === "network"
    ) {
      return { rows: [], estimated };
    }
    for (const chunk of this.chunked(query.sigilIds)) {
      const where = this.sigilViewsWhere(query, chunk, traffic);
      if (!where) break;
      const result = await this.datasets.views.query({
        from: this.instant(window.from),
        to: this.instant(window.to),
        where,
        groupBy: [column],
        select: { count: "sum", entries: "sum" },
      });
      estimated ||= result.estimated;
      for (const row of result.rows) {
        const value = String(row[column] ?? "");
        if (!value) continue;
        const views =
          Number(dimension === "entry" ? row.entries : row.count) || 0;
        if (views > 0) rows.set(value, (rows.get(value) ?? 0) + views);
      }
    }
    return {
      rows: [...rows.entries()].map(([value, views]) => ({ value, views })),
      estimated,
    };
  }

  // -------------------------------------------------------------------------
  // buckets

  protected assertQuery(query: SigilInsightsQuery): void {
    if (!(query.from < query.to)) {
      throw new AlephaError("An insights range must end after it starts.");
    }
    if (
      query.grain === "hour" &&
      query.to - query.from > SigilInsightsService.MAX_HOURLY_MS
    ) {
      throw new AlephaError(
        "An hourly grain is refused beyond 7 days; ask for day, week or month.",
      );
    }
    if (
      query.grain === "hour" &&
      query.from <
        this.floorDay(this.dateTime.nowMillis()) -
          SigilInsightsService.HOURLY_KEPT_MS
    ) {
      throw new AlephaError(
        "An hourly grain is refused more than 30 days back, where views are kept by day; ask for day, week or month.",
      );
    }
    const buckets = this.bucketCount(query);
    if (buckets > SigilInsightsService.MAX_BUCKETS) {
      throw new AlephaError(
        `This range has ${buckets} ${query.grain} buckets, more than ${SigilInsightsService.MAX_BUCKETS}; ask for a coarser grain or a shorter range.`,
      );
    }
  }

  protected bucketCount(query: SigilInsightsQuery): number {
    const first = this.bucketStart(
      EventLogPlan.bucket(query.from, query.grain),
      query.grain,
    );
    let count = 0;
    for (
      let start = first;
      start < query.to && count <= SigilInsightsService.MAX_BUCKETS;
      start = this.bucketEnd(start, query.grain)
    ) {
      count++;
    }
    return count;
  }

  protected bucketStart(key: string, grain: EventLogGrain): number {
    if (grain === "hour") return Date.parse(`${key}:00:00.000Z`);
    if (grain === "month") return Date.parse(`${key}-01T00:00:00.000Z`);
    return Date.parse(`${key}T00:00:00.000Z`);
  }

  protected bucketEnd(start: number, grain: EventLogGrain): number {
    if (grain === "hour") return start + 3_600_000;
    if (grain === "day") return start + 86_400_000;
    if (grain === "week") return start + 7 * 86_400_000;
    const date = new Date(start);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }

  protected floorDay(millis: number): number {
    return Math.floor(millis / 86_400_000) * 86_400_000;
  }

  /**
   * Every bucket the range touches, at zero, views counted and visitors
   * not yet (null until a part of the range that counts them fills it).
   */
  protected zeroBuckets(
    query: SigilInsightsQuery,
  ): Map<string, SigilInsightsBucket> {
    const buckets = new Map<string, SigilInsightsBucket>();
    let start = this.bucketStart(
      EventLogPlan.bucket(query.from, query.grain),
      query.grain,
    );
    while (start < query.to) {
      const key = EventLogPlan.bucket(start, query.grain);
      buckets.set(key, { bucket: key, visitors: null, visits: null, views: 0 });
      start = this.bucketEnd(start, query.grain);
    }
    return buckets;
  }

  protected chunked(sigilIds: string[]): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < sigilIds.length; index += this.SIGIL_CHUNK) {
      chunks.push(sigilIds.slice(index, index + this.SIGIL_CHUNK));
    }
    return chunks;
  }
}
