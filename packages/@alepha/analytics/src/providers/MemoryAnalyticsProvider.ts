import { AlephaError } from "alepha";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsAggregate,
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsProvider, type AnalyticsRow } from "./AnalyticsProvider.ts";

/**
 * An in-memory dataset, and the reference implementation of the seam.
 *
 * **Required, not a convenience.** `vitest` cannot bind an Analytics Engine
 * dataset and `wrangler dev` treats its writes as no-ops, so without an
 * in-process implementation there is no way to exercise the query semantics at
 * all. Every behaviour the conformance suite pins is defined here first.
 *
 * Tiering is simulated by rewriting a row's bucket in place, which is exactly
 * what the relational provider does with two tables — so a boundary-spanning
 * query can be tested with no database.
 */
export class MemoryAnalyticsProvider extends AnalyticsProvider {
  protected readonly stored = new Map<string, AnalyticsRow[]>();

  public async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    const existing = this.stored.get(dataset.name) ?? [];
    existing.push(...rows.map((row) => ({ ...row })));
    this.stored.set(dataset.name, existing);
  }

  public async query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const rows = (this.stored.get(dataset.name) ?? []).filter((row) =>
      this.matches(row, query),
    );

    const groupBy = query.groupBy ?? [];
    const groups = new Map<string, Record<string, string | number>>();

    for (const row of rows) {
      const key = groupBy
        .map((name) => String(this.dimensionOf(row, name)))
        .join("|");
      let group = groups.get(key);
      if (!group) {
        group = {};
        for (const name of groupBy) group[name] = this.dimensionOf(row, name);
        groups.set(key, group);
      }
      for (const [measure, aggregate] of Object.entries(query.select)) {
        group[measure] = this.fold(
          group[measure],
          Number(row[measure] ?? 0),
          aggregate,
        );
      }
    }

    let out = [...groups.values()];

    // With no groupBy the result is one total row — but only when something
    // matched. An empty match must stay empty rather than reporting zero,
    // otherwise "no data" and "measured zero" become indistinguishable.
    if (groupBy.length === 0) {
      out = rows.length === 0 ? [] : out;
    }

    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      out.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    if (query.limit !== undefined) out = out.slice(0, query.limit);

    return { rows: out, estimated: false };
  }

  public async rollup(
    dataset: AnalyticsDataset,
    before: string,
  ): Promise<void> {
    const rows = this.stored.get(dataset.name) ?? [];
    const folded = new Map<string, AnalyticsRow>();
    const kept: AnalyticsRow[] = [];

    for (const row of rows) {
      if (AnalyticsBuckets.day(row.hour) >= AnalyticsBuckets.day(before)) {
        kept.push(row);
        continue;
      }
      // Folding to the day bucket is what makes this idempotent: a row already
      // folded has hour === day, so re-running maps it onto itself.
      const day = AnalyticsBuckets.day(row.hour);
      const key = [day, ...this.dimensionsOf(dataset, row)].join("|");
      const existing = folded.get(key);
      if (existing) {
        for (const measure of Object.keys(dataset.measures.shape)) {
          existing[measure] =
            Number(existing[measure] ?? 0) + Number(row[measure] ?? 0);
        }
      } else {
        folded.set(key, { ...row, hour: day });
      }
    }

    this.stored.set(dataset.name, [...folded.values(), ...kept]);
  }

  public async prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    const rows = this.stored.get(dataset.name) ?? [];
    this.stored.set(
      dataset.name,
      rows.filter(
        (row) => AnalyticsBuckets.day(row.hour) >= AnalyticsBuckets.day(before),
      ),
    );
  }

  protected dimensionsOf(
    dataset: AnalyticsDataset,
    row: AnalyticsRow,
  ): string[] {
    return Object.keys(dataset.dimensions.shape)
      .sort()
      .map((name) => String(row[name]));
  }

  protected dimensionOf(row: AnalyticsRow, name: string): string | number {
    if (name === "day") return AnalyticsBuckets.day(row.hour);
    if (name === "hour") return row.hour;
    return row[name];
  }

  protected matches(row: AnalyticsRow, query: AnalyticsQuery): boolean {
    if (AnalyticsBuckets.day(row.hour) < query.since) return false;
    for (const [name, filter] of Object.entries(query.where ?? {})) {
      const value = row[name];
      if (
        typeof filter === "object" &&
        filter !== null &&
        "inArray" in filter
      ) {
        if (!filter.inArray.includes(value)) return false;
      } else if (value !== filter) {
        return false;
      }
    }
    return true;
  }

  protected fold(
    current: string | number | undefined,
    value: number,
    aggregate: AnalyticsAggregate,
  ): number {
    if (aggregate === "count") return Number(current ?? 0) + 1;
    if (current === undefined) return value;
    const left = Number(current);
    if (aggregate === "sum") return left + value;
    if (aggregate === "min") return Math.min(left, value);
    if (aggregate === "max") return Math.max(left, value);
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }
}
