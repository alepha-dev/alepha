import { $inject, z } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import type { VitalMetric } from "../shared/schemas/sigilVitalsBuckets.ts";
import type {
  AnalyticsBatch,
  AnalyticsLeaderboardRow,
  AnalyticsStore,
  AnalyticsTimelinePoint,
  AnalyticsVitalHistograms,
  AnalyticsWindow,
} from "./AnalyticsStore.ts";
import {
  type SigilAnalyticsEntities,
  UNIQUES_COLLAPSED_HASH,
  VITALS_BUCKET_COUNT,
  vitalsBucketColumn,
} from "./createSigilAnalyticsEntities.ts";

/**
 * The default {@link AnalyticsStore}: three relational tables, aggregated on
 * write.
 *
 * This is what any Node or Postgres deployment runs, and it stays the answer
 * for unique visitors even on Cloudflare — see `AnalyticsStore` for why the
 * Analytics Engine cannot count distinct values it does not index.
 *
 * ## Why a class factory
 *
 * `$repository()` needs the entity at class-field declaration time, and the
 * entities are per-app: they carry a foreign key into the consuming app's
 * `sigils` table (see `createSigilAnalyticsEntities`). Returning a class
 * closed over them keeps `$repository` — and therefore the whole DI and
 * substitution story — intact:
 *
 * ```ts
 * const analytics = createSigilAnalyticsEntities({ sigilIdRef: () => sigils.cols.id });
 * export class AppAnalyticsStore extends createOrmAnalyticsStore(analytics) {}
 * ```
 *
 * ## Everything is one statement
 *
 * Both write paths are a single `INSERT … ON CONFLICT DO UPDATE … + excluded.…`
 * for the whole batch. Reading before writing would lose samples under exactly
 * the load these tables exist to measure, and a loop of single upserts would
 * cost a round-trip per sample. The batch is folded by the caller first, which
 * is not only a speed concern: one statement carries one `ON CONFLICT` clause
 * and Postgres refuses to touch the same row twice inside it.
 */
export const createOrmAnalyticsStore = (entities: SigilAnalyticsEntities) =>
  class OrmAnalyticsStore implements AnalyticsStore {
    protected database = $inject(DatabaseProvider);
    protected views = $repository(entities.views);
    protected uniques = $repository(entities.uniques);
    protected vitals = $repository(entities.vitals);

    async absorb(batch: AnalyticsBatch): Promise<void> {
      if (batch.views?.length) {
        await this.views.upsertMany(batch.views, {
          target: ["sigilId", "hour", "path", "country"],
          set: {
            count: sql`${this.views.table.count} + excluded.${sql.raw(this.views.table.count.name)}`,
          },
        });
      }

      if (batch.uniques?.length) {
        // The conflict IS the expected case — a returning visitor. Setting the
        // day to itself makes it a no-op rather than an error, and crucially
        // does NOT add to `count`: a unique seen twice is still one.
        await this.uniques.upsertMany(
          batch.uniques.map((sample) => ({
            sigilId: sample.sigilId,
            day: sample.day,
            visitorHash: sample.visitorHash,
          })),
          {
            target: ["sigilId", "day", "visitorHash"],
            set: {
              day: sql`excluded.${sql.raw(this.uniques.table.day.name)}`,
            },
          },
        );
      }

      if (batch.vitals?.length) {
        // Fold to one row per `(sigilId, hour, metric, path)` carrying a count
        // per bucket column. The samples arrive one bucket at a time, and the
        // table is one row per key with seven counters.
        const rows = new Map<
          string,
          Record<string, string | number> & { sigilId: string }
        >();
        for (const sample of batch.vitals) {
          const key = `${sample.sigilId}|${sample.hour}|${sample.metric}|${sample.path}`;
          let row = rows.get(key);
          if (!row) {
            row = {
              sigilId: sample.sigilId,
              hour: sample.hour,
              metric: sample.metric,
              path: sample.path,
              ...this.zeroBuckets(),
            };
            rows.set(key, row);
          }
          const column = vitalsBucketColumn(sample.bucket);
          row[column] = (row[column] as number) + sample.count;
        }

        await this.vitals.upsertMany([...rows.values()] as never, {
          target: ["sigilId", "hour", "metric", "path"],
          set: this.bucketIncrements(),
        });
      }
    }

    async totalViews(window: AnalyticsWindow): Promise<number> {
      if (window.sigilIds.length === 0) return 0;
      const [row] = await this.database.run(
        sql`
          SELECT COALESCE(SUM(${this.views.table.count}), 0) AS total
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${this.scope(window)})
            AND ${this.views.table.hour} >= ${window.since}
        `,
        z.object({ total: z.coerce.number() }),
      );
      return Number(row?.total) || 0;
    }

    async uniqueVisitors(window: AnalyticsWindow): Promise<number> {
      if (window.sigilIds.length === 0) return 0;
      // Two row shapes, two halves of one number. Hash rows are counted as
      // distinct `(day, visitorHash)` pairs rather than rows, so the same
      // person visiting two of a project's apps on one day is one visitor;
      // one row per sigil would say two.
      //
      // Collapsed rows no longer carry hashes, so all they can be is summed.
      // That loses cross-app dedup for those days and can over-count a visitor
      // who used two apps — accepted: the alternative is keeping per-visitor
      // hashes indefinitely, and the whole point of the collapse is that they
      // stop existing.
      const [row] = await this.database.run(
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
          WHERE ${this.uniques.table.sigilId} IN (${this.scope(window)})
            AND ${this.uniques.table.day} >= ${window.since}
        `,
        z.object({ uniques: z.coerce.number() }),
      );
      return Number(row?.uniques) || 0;
    }

    async timeline(window: AnalyticsWindow): Promise<AnalyticsTimelinePoint[]> {
      if (window.sigilIds.length === 0) return [];
      // `substr(hour, 1, 10)` is the day inside the hour bucket — the storage
      // stays hourly, the chart asks for days.
      const rows = await this.database.run(
        sql`
          SELECT substr(${this.views.table.hour}, 1, 10) AS date,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${this.scope(window)})
            AND ${this.views.table.hour} >= ${window.since}
          GROUP BY substr(${this.views.table.hour}, 1, 10)
        `,
        z.object({ date: z.string(), count: z.coerce.number() }),
      );
      return rows
        .map((row) => ({ date: row.date, views: Number(row.count) || 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    async topPaths(
      window: AnalyticsWindow,
      limit: number,
    ): Promise<AnalyticsLeaderboardRow[]> {
      return this.leaderboard(window, limit, this.views.table.path);
    }

    async topCountries(
      window: AnalyticsWindow,
      limit: number,
    ): Promise<AnalyticsLeaderboardRow[]> {
      return this.leaderboard(window, limit, this.views.table.country);
    }

    async vitalHistograms(
      window: AnalyticsWindow,
    ): Promise<AnalyticsVitalHistograms> {
      if (window.sigilIds.length === 0) return {};
      // One read for the window, folded in memory. SQL could SUM the bucket
      // columns, but the fold is per metric and the row count is bounded by
      // (hour × metric × path) rather than by traffic — so a GROUP BY would
      // buy nothing and cost a second shape to keep in step with the walk.
      const rows = await this.vitals.findMany({
        where: {
          sigilId: { inArray: window.sigilIds },
          hour: { gte: window.since },
        },
        columns: [
          "metric",
          ...Array.from({ length: VITALS_BUCKET_COUNT }, (_, i) =>
            vitalsBucketColumn(i),
          ),
        ] as never,
      });

      const histograms: AnalyticsVitalHistograms = {};
      for (const row of rows as unknown as Array<
        Record<string, number | string>
      >) {
        const metric = row.metric as VitalMetric;
        const histogram = histograms[metric] ?? new Map<number, number>();
        for (let index = 0; index < VITALS_BUCKET_COUNT; index++) {
          const count = (row[vitalsBucketColumn(index)] as number) ?? 0;
          if (count === 0) continue;
          histogram.set(index, (histogram.get(index) ?? 0) + count);
        }
        histograms[metric] = histogram;
      }
      return histograms;
    }

    protected scope(window: AnalyticsWindow) {
      return sql.join(
        window.sigilIds.map((id) => sql`${id}`),
        sql`, `,
      );
    }

    protected async leaderboard(
      window: AnalyticsWindow,
      limit: number,
      column: { name: string },
    ): Promise<AnalyticsLeaderboardRow[]> {
      const rows = await this.database.run(
        sql`
          SELECT ${column} AS key,
                 SUM(${this.views.table.count}) AS count
          FROM ${this.views.table}
          WHERE ${this.views.table.sigilId} IN (${this.scope(window)})
            AND ${this.views.table.hour} >= ${window.since}
          GROUP BY ${column}
          ORDER BY count DESC
          LIMIT ${limit}
        `,
        z.object({ key: z.string(), count: z.coerce.number() }),
      );
      return rows.map((row) => ({
        key: row.key,
        count: Number(row.count) || 0,
      }));
    }

    /** A zeroed count for every bucket column. */
    protected zeroBuckets(): Record<string, number> {
      const counts: Record<string, number> = {};
      for (let i = 0; i < VITALS_BUCKET_COUNT; i++) {
        counts[vitalsBucketColumn(i)] = 0;
      }
      return counts;
    }

    /**
     * `bN = bN + excluded.bN` for every bucket column.
     *
     * `excluded`, not a literal `+ 1`: the batch was folded first, so a row can
     * carry several samples for the same bucket and the update has to add what
     * actually arrived. Buckets with no sample add zero, which is why every
     * column can be listed unconditionally.
     */
    protected bucketIncrements(): Record<string, ReturnType<typeof sql>> {
      const set: Record<string, ReturnType<typeof sql>> = {};
      for (let i = 0; i < VITALS_BUCKET_COUNT; i++) {
        const column = vitalsBucketColumn(i);
        const name = (
          this.vitals.table as never as Record<string, { name: string }>
        )[column].name;
        set[column] =
          sql`${(this.vitals.table as never as Record<string, unknown>)[column]} + excluded.${sql.raw(name)}`;
      }
      return set;
    }
  };
