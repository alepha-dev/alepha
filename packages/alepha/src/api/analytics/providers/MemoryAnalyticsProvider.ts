import { AlephaError } from "alepha";

import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsFolds } from "../planner/AnalyticsFolds.ts";
import { AnalyticsOrdering } from "../planner/AnalyticsOrdering.ts";
import { AnalyticsRowFolder } from "../planner/AnalyticsRowFolder.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import {
  AnalyticsProvider,
  type AnalyticsRow,
  type AnalyticsTier,
} from "./AnalyticsProvider.ts";

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
  public readonly exact: boolean = true;

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
    // Merged into the row holding the same key, as a relational upsert does,
    // so a gauge's extremes and last value fold on write here too.
    const existing = this.stored.get(dataset.name) ?? [];
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const index = new Map(
      existing.map((row) => [AnalyticsRowFolder.key(dimensions, row), row]),
    );
    for (const row of rows) {
      const key = AnalyticsRowFolder.key(dimensions, row);
      const target = index.get(key);
      if (target) {
        AnalyticsFolds.merge(dataset, target, row);
      } else {
        const copy = { ...row };
        existing.push(copy);
        index.set(key, copy);
      }
    }
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
      if (name !== "day" && name !== "hour" && name !== "minute") {
        this.assertKnownDimension(dataset, name);
      }
    }
    const selections = AnalyticsFolds.selections(dataset, query.select);

    const rows = (this.stored.get(dataset.name) ?? []).filter((row) =>
      this.matches(row, query),
    );

    const groupBy = query.groupBy ?? [];
    const groups = new Map<string, Record<string, string | number | null>>();
    // The `at` behind each group's `last` values, by selection key.
    const lastAt = new Map<string, Record<string, number | null>>();

    for (const row of rows) {
      // JSON.stringify escapes properly and is unambiguous for any input,
      // unlike a delimiter-joined string: unsanitised dimension values (a URL
      // path can carry any character) could otherwise collide across
      // distinct groups.
      const key = JSON.stringify(
        groupBy.map((name) => this.dimensionOf(row, name)),
      );
      let group = groups.get(key);
      let ats = lastAt.get(key);
      if (!group || !ats) {
        group = {};
        ats = {};
        for (const name of groupBy) group[name] = this.dimensionOf(row, name);
        for (const selection of selections) {
          group[selection.key] = null;
          ats[selection.key] = null;
        }
        groups.set(key, group);
        lastAt.set(key, ats);
      }
      for (const selection of selections) {
        const value = row[selection.name];
        if (selection.fold === "last") {
          const at = row[AnalyticsFolds.lastAt(selection.measure)];
          if (
            AnalyticsFolds.laterWins(
              group[selection.key],
              ats[selection.key],
              value,
              at,
            )
          ) {
            group[selection.key] = AnalyticsFolds.reading(value);
            ats[selection.key] = AnalyticsFolds.reading(at);
          }
        } else if (AnalyticsFolds.isSumOnly(dataset, selection.measure)) {
          group[selection.key] =
            Number(group[selection.key] ?? 0) + Number(value ?? 0);
        } else {
          group[selection.key] = AnalyticsFolds.combine(
            selection.fold,
            group[selection.key],
            value,
          );
        }
      }
    }

    // With no groupBy the result is one total row — but only when something
    // matched. An empty match stays empty rather than reporting zero, so that
    // "no data" and "measured zero" remain distinguishable. This falls out of
    // the grouping loop above: no matching rows means no group was ever
    // created.
    let out = [...groups.values()];

    out = AnalyticsOrdering.apply(out, query);

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
        AnalyticsFolds.merge(dataset, existing, row);
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

  /**
   * A scan: one array holds both tiers, told apart by key length (a rolled
   * row's bucket is a bare `YYYY-MM-DD`).
   */
  public async oldestBucket(
    dataset: AnalyticsDataset,
    tier: AnalyticsTier,
  ): Promise<string | undefined> {
    let oldest: string | undefined;
    for (const row of this.stored.get(dataset.name) ?? []) {
      const rolled = row.hour.length === 10;
      if (rolled !== (tier === "rolled")) continue;
      if (oldest === undefined || row.hour < oldest) oldest = row.hour;
    }
    return oldest;
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
    // The stored key itself; a rolled row answers with its day key.
    if (name === "minute") return row.hour;
    if (name === "hour") return row.hour.slice(0, 13);
    return row[name] as string | number;
  }

  protected matches(row: AnalyticsRow, query: AnalyticsQuery): boolean {
    const day = AnalyticsBuckets.day(row.hour);
    if (day < query.since) return false;
    // Inclusive: `until` names a day, and every hour of that day is in it.
    if (query.until && day > query.until) return false;
    for (const [name, filter] of Object.entries(query.where ?? {})) {
      const value = row[name] as string | number;
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
}
