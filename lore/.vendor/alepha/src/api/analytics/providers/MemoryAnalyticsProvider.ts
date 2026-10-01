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
 * what the relational provider does with two tables - so a boundary-spanning
 * query can be tested with no database.
 */
export class MemoryAnalyticsProvider extends AnalyticsProvider {
  protected readonly stored = new Map<string, AnalyticsRow[]>();

  /**
   * No-op: memory storage is a plain `Map` keyed by dataset name at first
   * write, so there is nothing to declare ahead of time.
   *
   * Takes `dataset` (unused) rather than dropping the parameter, so the
   * signature matches {@link AnalyticsProvider.register} exactly — a narrower
   * override here would make it unsound for a subclass (e.g. a test's
   * recording provider) to override with the full signature.
   */
  public register(dataset: AnalyticsDataset): void {
    // Nothing to declare — see the class doc.
  }

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
    for (const name of Object.keys(query.where ?? {})) {
      this.assertKnownDimension(dataset, name);
    }
    for (const name of query.groupBy ?? []) {
      if (name !== "day" && name !== "hour") {
        this.assertKnownDimension(dataset, name);
      }
    }
    for (const name of Object.keys(query.select)) {
      this.assertKnownMeasure(dataset, name);
    }

    const rows = (this.stored.get(dataset.name) ?? []).filter((row) =>
      this.matches(row, query),
    );

    const groupBy = query.groupBy ?? [];
    const groups = new Map<string, Record<string, string | number>>();

    for (const row of rows) {
      // JSON.stringify escapes properly and is unambiguous for any input,
      // unlike a delimiter-joined string: unsanitised dimension values (a URL
      // path can carry any character) could otherwise collide across
      // distinct groups.
      const key = JSON.stringify(
        groupBy.map((name) => this.dimensionOf(row, name)),
      );
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

    // With no groupBy the result is one total row — but only when something
    // matched. An empty match stays empty rather than reporting zero, so that
    // "no data" and "measured zero" remain distinguishable. This falls out of
    // the grouping loop above: no matching rows means no group was ever
    // created.
    let out = [...groups.values()];

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
      // JSON.stringify avoids the collision a delimiter-joined string would
      // risk here — and unlike in query(), a collision in rollup is
      // irreversible: the colliding groups get summed and the pre-fold rows
      // are gone.
      const key = JSON.stringify([day, ...this.dimensionsOf(dataset, row)]);
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
    const day = AnalyticsBuckets.day(row.hour);
    if (day < query.since) return false;
    // Inclusive: `until` names a day, and every hour of that day is in it.
    if (query.until && day > query.until) return false;
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
    if (aggregate === "sum") return Number(current ?? 0) + value;
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }

  /**
   * Refuses a query name (from `where`/`groupBy`) that is not one of the
   * dataset's own declared dimensions.
   *
   * `OrmAnalyticsProvider` and `WaeAnalyticsProvider` both throw `AlephaError`
   * for an unknown name — the former because it is about to splice the name
   * into SQL text, the latter because it resolves the name to a slot. This
   * provider had no equivalent guard: an undeclared name silently fell
   * through to `matches`/`dimensionOf`, which read `row[name]` as
   * `undefined` and produced empty rows or a folded `0` instead of an error.
   * Since Memory is the provider every test runs against, a typo'd dimension
   * name used to be green in every test suite and only surfaced as a 500 in
   * production, against a real backend.
   */
  protected assertKnownDimension(
    dataset: AnalyticsDataset,
    name: string,
  ): void {
    if (!Object.hasOwn(dataset.dimensions.shape, name)) {
      throw new AlephaError(
        `Query on dataset '${dataset.name}' references '${name}', which is not a declared dimension. Declared dimensions: ${Object.keys(dataset.dimensions.shape).join(", ") || "(none)"}.`,
      );
    }
  }

  /**
   * Same guard as {@link assertKnownDimension}, for `select` keys against the
   * dataset's declared measures.
   */
  protected assertKnownMeasure(dataset: AnalyticsDataset, name: string): void {
    if (!Object.hasOwn(dataset.measures.shape, name)) {
      throw new AlephaError(
        `Query on dataset '${dataset.name}' references '${name}', which is not a declared measure. Declared measures: ${Object.keys(dataset.measures.shape).join(", ") || "(none)"}.`,
      );
    }
  }
}
