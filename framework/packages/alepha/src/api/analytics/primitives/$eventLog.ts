import type { PrimitiveSide, ZObject } from "alepha";
import { $inject, createPrimitive, Primitive } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { KIND } from "alepha/internal";
import { $logger } from "alepha/logger";

import { EventLogPlan } from "../planner/EventLogPlan.ts";
import { EventLogProvider } from "../providers/EventLogProvider.ts";
import type {
  AnalyticsEventLog,
  EventLogQuery,
  EventLogResult,
  EventLogRow,
  EventLogStoredRow,
} from "../schemas/eventLogSchema.ts";

/**
 * Declares an event log: one stored row per event, kept for a bounded time,
 * queried with exact distinct counts under any combination of filters.
 *
 * A dataset (`$analytics`) folds events into a sum per bucket as they are
 * recorded, which is cheap to keep forever but cannot say how many
 * *different* visitors, sessions or devices a bucket saw. An event log keeps
 * the events themselves, so it can, for as long as `keep` says.
 *
 * Append only: a later fact about an event (an engagement after a view) is
 * a row of its own. Every backend that holds an event log is exact, so a
 * result always reports `estimated: false`.
 *
 * @example
 * ```ts
 * class Traffic {
 *   pageviews = $eventLog({
 *     name: "pageviews",
 *     index: "appId",
 *     schema: z.object({
 *       appId: z.text(),
 *       sessionId: z.text(),
 *       path: z.text(),
 *       country: z.text(),
 *       views: z.integer(),
 *     }),
 *     keep: "90d",
 *   });
 *
 *   async onView(appId: string, sessionId: string, path: string, country: string) {
 *     await this.pageviews.append([{ appId, sessionId, path, country, views: 1 }]);
 *   }
 *
 *   async topPages(appId: string) {
 *     return this.pageviews.query({
 *       since: "2026-11-01",
 *       where: { appId },
 *       groupBy: ["path"],
 *       select: {
 *         views: { sum: "views" },
 *         visitors: { distinct: "sessionId" },
 *       },
 *       orderBy: { key: "visitors", direction: "desc" },
 *       limit: 20,
 *     });
 *   }
 * }
 * ```
 */
export const $eventLog = (options: EventLogPrimitiveOptions) =>
  createPrimitive(EventLogPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface EventLogPrimitiveOptions extends Omit<
  AnalyticsEventLog,
  "name" | "index" | "schema" | "keep"
> {
  /**
   * Storage-facing name, snake_case. Defaults to the property key, which
   * must then be snake_case itself. The relational table is
   * `analytics_<name>_events`.
   */
  name?: string;
  /**
   * The column nearly every query filters on, such as an app or a tenant.
   * The table is indexed on it and on the event time.
   */
  index: string;
  /**
   * The columns of a row: strings, numbers and booleans. A column a row may
   * leave empty is declared `.nullable().optional()`. The event's time is not
   * a column: it is `at` on the appended row.
   */
  schema: ZObject;
  /**
   * How long a row is kept: `<n>h` or `<n>d`, such as `"90d"`. Older rows are
   * refused on append and deleted by the hourly sweep of
   * `AlephaApiAnalyticsRollup`.
   */
  keep: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class EventLogPrimitive extends Primitive<EventLogPrimitiveOptions> {
  /**
   * `boot`: registers its table at init, before the container starts.
   */
  public static override readonly side: PrimitiveSide = "boot";

  /**
   * How far ahead of the server clock an event's `at` may be before it is
   * clamped to now, as for a dataset reading.
   */
  public static readonly MAX_CLOCK_SKEW = 5 * 60 * 1000;

  protected readonly log = $logger();
  protected readonly provider = $inject(EventLogProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  public get eventLog(): AnalyticsEventLog {
    return {
      ...this.options,
      name: this.options.name ?? this.config.propertyKey,
    };
  }

  /**
   * Validates the declaration and registers it with the bound provider,
   * before `alepha.start()` locks the container and runs migrations.
   */
  protected onInit(): void {
    EventLogPlan.assertValid(this.eventLog);
    this.provider.register(this.eventLog);
  }

  /**
   * Appends a batch, one stored row per event.
   *
   * Each row is placed by `at` (millis, default now). An `at` more than
   * {@link MAX_CLOCK_SKEW} ahead of the server clock is clamped to now; one
   * older than `keep` is dropped, since the sweep would delete it anyway.
   * A column the row omits is stored as `null`.
   */
  public async append(rows: EventLogRow[]): Promise<void> {
    const log = this.eventLog;
    const now = this.dateTime.nowMillis();
    const keep = EventLogPlan.keepMillis(log);
    const columns = Object.keys(log.schema.shape);

    const stored: EventLogStoredRow[] = [];
    for (const row of rows) {
      let at = row.at ?? now;
      if (at > now + EventLogPrimitive.MAX_CLOCK_SKEW) {
        this.log.debug(
          `Clamped an event of '${log.name}' ${at - now} ms in the future to now`,
        );
        at = now;
      } else if (at < now - keep) {
        this.log.debug(
          `Dropped an event of '${log.name}' ${now - at} ms old, past its keep window`,
        );
        continue;
      }
      const out: EventLogStoredRow = { at };
      for (const column of columns) out[column] = row[column] ?? null;
      stored.push(out);
    }
    if (stored.length === 0) return;
    await this.provider.append(log, stored);
  }

  public async query(query: EventLogQuery): Promise<EventLogResult> {
    EventLogPlan.selections(this.eventLog, query);
    return this.provider.query(this.eventLog, query);
  }
}

$eventLog[KIND] = EventLogPrimitive;
