import { AnalyticsOrdering } from "../planner/AnalyticsOrdering.ts";
import {
  type EventLogSelection,
  EventLogPlan,
} from "../planner/EventLogPlan.ts";
import type {
  AnalyticsEventLog,
  EventLogQuery,
  EventLogResult,
  EventLogStoredRow,
} from "../schemas/eventLogSchema.ts";
import { EventLogProvider } from "./EventLogProvider.ts";

type Value = string | number | boolean | null;

/**
 * Event logs in process memory: the provider every test runs on, and the
 * reference the relational provider is held to by the conformance suite.
 */
export class MemoryEventLogProvider extends EventLogProvider {
  protected readonly rows = new Map<string, EventLogStoredRow[]>();

  public register(log: AnalyticsEventLog): void {
    if (!this.rows.has(log.name)) this.rows.set(log.name, []);
  }

  public async append(
    log: AnalyticsEventLog,
    rows: EventLogStoredRow[],
  ): Promise<void> {
    this.register(log);
    this.rows.get(log.name)?.push(...rows.map((row) => ({ ...row })));
  }

  /**
   * Every stored row of `log`, oldest first; for tests and the sweep.
   */
  public all(log: AnalyticsEventLog): EventLogStoredRow[] {
    return [...(this.rows.get(log.name) ?? [])].sort((a, b) => a.at - b.at);
  }

  public async query(
    log: AnalyticsEventLog,
    query: EventLogQuery,
  ): Promise<EventLogResult> {
    const selections = EventLogPlan.selections(log, query);
    const { lower, upper } = EventLogPlan.bounds(query);
    const groupBy = query.groupBy ?? [];

    const groups = new Map<
      string,
      { keys: Record<string, Value>; rows: EventLogStoredRow[] }
    >();
    for (const row of this.rows.get(log.name) ?? []) {
      if (row.at < lower || (upper !== undefined && row.at >= upper)) continue;
      if (!this.matches(row, query)) continue;
      const keys: Record<string, Value> = {};
      for (const name of groupBy) {
        keys[name] = EventLogPlan.isGrain(name)
          ? EventLogPlan.bucket(row.at, name)
          : (row[name] ?? null);
      }
      const id = JSON.stringify(groupBy.map((name) => keys[name]));
      const group = groups.get(id) ?? { keys, rows: [] };
      group.rows.push(row);
      groups.set(id, group);
    }

    const rows = [...groups.values()].map(({ keys, rows }) => {
      const out: Record<string, Value> = { ...keys };
      for (const selection of selections) {
        out[selection.key] = this.compute(selection, rows);
      }
      return out;
    });

    return { rows: AnalyticsOrdering.apply(rows, query), estimated: false };
  }

  protected matches(row: EventLogStoredRow, query: EventLogQuery): boolean {
    for (const [name, filter] of Object.entries(query.where ?? {})) {
      const value = row[name];
      if (typeof filter === "object" && filter !== null) {
        if (!filter.inArray.some((candidate) => candidate === value)) {
          return false;
        }
      } else if (value !== filter) {
        return false;
      }
    }
    return true;
  }

  protected compute(
    selection: EventLogSelection,
    rows: EventLogStoredRow[],
  ): number | null {
    if (selection.op === "count") {
      if (selection.column === "*") return rows.length;
      return rows.filter((row) => (row[selection.column] ?? null) !== null)
        .length;
    }
    const values = rows
      .map((row) => row[selection.column])
      .filter((value) => value !== null && value !== undefined);
    if (selection.op === "distinct") return new Set(values).size;
    const numbers = values.map(Number);
    if (numbers.length === 0) return null;
    if (selection.op === "sum") return numbers.reduce((a, b) => a + b, 0);
    if (selection.op === "min") return Math.min(...numbers);
    return Math.max(...numbers);
  }
}
