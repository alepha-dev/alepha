import { AlephaError } from "alepha";

import type { AnalyticsQuery } from "../schemas/analyticsQuerySchema.ts";
import type {
  AnalyticsEventLog,
  EventLogGrain,
  EventLogMeasure,
  EventLogQuery,
} from "../schemas/eventLogSchema.ts";
import { AnalyticsBuckets } from "./AnalyticsBuckets.ts";
import { AnalyticsWindow } from "./AnalyticsWindow.ts";

/**
 * One selected value of an event log query, resolved: its returned key,
 * what it computes, and over which column (`"*"` for a row count).
 */
export interface EventLogSelection {
  key: string;
  op: "count" | "sum" | "min" | "max" | "distinct";
  column: string;
}

/**
 * The rules every event log backend shares: what a declaration and a query
 * may say, which instants a window covers, and which bucket an instant falls
 * in. Pure functions over millis, so every backend agrees and `travel()`
 * stays meaningful in tests.
 */
export class EventLogPlan {
  public static readonly NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

  public static readonly GRAINS: readonly EventLogGrain[] = [
    "hour",
    "day",
    "week",
    "month",
  ];

  public static readonly OPS = [
    "count",
    "sum",
    "min",
    "max",
    "distinct",
  ] as const;

  /**
   * Column names a log may not declare: `at` is the event time on a row,
   * `event_at` its stored column, and the grains would shadow a column in
   * `groupBy`.
   */
  public static readonly RESERVED = ["at", "event_at", ...EventLogPlan.GRAINS];

  /**
   * Refuses a declaration that no backend could store or query faithfully.
   */
  public static assertValid(log: AnalyticsEventLog): void {
    if (!EventLogPlan.NAME_PATTERN.test(log.name)) {
      throw new AlephaError(
        `Event log name '${log.name}' must be snake_case: lowercase letters, digits and underscores, starting with a letter. Rename the property or pass an explicit { name: "..." }.`,
      );
    }
    const columns = Object.keys(log.schema.shape);
    for (const column of columns) {
      if (EventLogPlan.RESERVED.includes(column)) {
        throw new AlephaError(
          `Event log '${log.name}' declares a column '${column}', a reserved name (${EventLogPlan.RESERVED.join(", ")}).`,
        );
      }
    }
    if (!columns.includes(log.index)) {
      throw new AlephaError(
        `Event log '${log.name}' is indexed on '${log.index}', which is not one of its columns: ${columns.join(", ") || "(none)"}.`,
      );
    }
    EventLogPlan.keepMillis(log);
  }

  /**
   * The keep window in millis. `<n>h` or `<n>d`, at least one hour.
   */
  public static keepMillis(log: AnalyticsEventLog): number {
    const match = /^(\d+)([hd])$/.exec(log.keep);
    if (!match || Number(match[1]) < 1) {
      throw new AlephaError(
        `Event log '${log.name}' declares keep '${log.keep}'; expected a positive count of hours or days, such as '48h' or '90d'.`,
      );
    }
    return AnalyticsBuckets.parseWindow(log.keep);
  }

  /**
   * Validates a query against its log and resolves its selections. Every
   * name a query carries is checked here, before any backend splices it
   * into a statement.
   */
  public static selections(
    log: AnalyticsEventLog,
    query: EventLogQuery,
  ): EventLogSelection[] {
    const window: AnalyticsQuery = {
      since: query.since,
      until: query.until,
      from: query.from,
      to: query.to,
      select: {},
    };
    AnalyticsWindow.assertValid(window);
    for (const name of Object.keys(query.where ?? {})) {
      EventLogPlan.assertColumn(log, name);
    }
    for (const name of query.groupBy ?? []) {
      if (!EventLogPlan.isGrain(name)) EventLogPlan.assertColumn(log, name);
    }

    const entries = Object.entries(query.select ?? {});
    if (entries.length === 0) {
      throw new AlephaError(
        `A query on event log '${log.name}' selects nothing; name at least one value, such as { events: { count: "*" } }.`,
      );
    }
    const selections = entries.map(([key, measure]) =>
      EventLogPlan.selection(log, key, measure),
    );

    const keys = new Set([
      ...(query.groupBy ?? []),
      ...selections.map((s) => s.key),
    ]);
    if (query.orderBy && !keys.has(query.orderBy.key)) {
      throw new AlephaError(
        `A query on event log '${log.name}' orders by '${query.orderBy.key}', which it neither groups by nor selects.`,
      );
    }
    if (
      query.limit !== undefined &&
      (!Number.isInteger(query.limit) || query.limit < 1)
    ) {
      throw new AlephaError(
        `A query on event log '${log.name}' asks for limit ${query.limit}; expected a positive integer.`,
      );
    }
    return selections;
  }

  protected static selection(
    log: AnalyticsEventLog,
    key: string,
    measure: EventLogMeasure,
  ): EventLogSelection {
    const ops = Object.keys(measure ?? {});
    const op = ops[0] as EventLogSelection["op"];
    if (ops.length !== 1 || !EventLogPlan.OPS.includes(op)) {
      throw new AlephaError(
        `Selection '${key}' on event log '${log.name}' must name exactly one of ${EventLogPlan.OPS.join(", ")}.`,
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new AlephaError(
        `Selection key '${key}' on event log '${log.name}' must be an identifier.`,
      );
    }
    const column = (measure as Record<string, string>)[op];
    if (!(op === "count" && column === "*")) {
      EventLogPlan.assertColumn(log, column);
    }
    return { key, op, column };
  }

  public static isGrain(name: string): name is EventLogGrain {
    return (EventLogPlan.GRAINS as readonly string[]).includes(name);
  }

  public static assertColumn(log: AnalyticsEventLog, name: string): void {
    if (!Object.hasOwn(log.schema.shape, name)) {
      throw new AlephaError(
        `A query on event log '${log.name}' references '${name}', which is not one of its columns: ${Object.keys(log.schema.shape).join(", ")}.`,
      );
    }
  }

  /**
   * The instants a query reads: `lower` included, `upper` excluded, open
   * above when the query names no upper bound.
   */
  public static bounds(query: EventLogQuery): {
    lower: number;
    upper?: number;
  } {
    if (query.since !== undefined) {
      return {
        lower: AnalyticsBuckets.startOf(query.since),
        upper:
          query.until === undefined
            ? undefined
            : AnalyticsBuckets.startOf(
                AnalyticsBuckets.shiftDays(query.until, 1),
              ),
      };
    }
    return {
      lower: Date.parse(query.from as string),
      upper: query.to === undefined ? undefined : Date.parse(query.to),
    };
  }

  /**
   * The key of the `grain` bucket `millis` falls in, UTC:
   * `YYYY-MM-DDTHH`, `YYYY-MM-DD`, the Monday of the ISO week as
   * `YYYY-MM-DD`, or `YYYY-MM`.
   */
  public static bucket(millis: number, grain: EventLogGrain): string {
    const iso = new Date(millis).toISOString();
    if (grain === "hour") return iso.slice(0, 13);
    if (grain === "day") return iso.slice(0, 10);
    if (grain === "month") return iso.slice(0, 7);
    const day = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
    const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday is 0
    return new Date(day - weekday * 86_400_000).toISOString().slice(0, 10);
  }
}
