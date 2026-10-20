import { AlephaError } from "alepha";

import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsFolds } from "../planner/AnalyticsFolds.ts";
import { AnalyticsOrdering } from "../planner/AnalyticsOrdering.ts";
import { AnalyticsRowFolder } from "../planner/AnalyticsRowFolder.ts";
import { AnalyticsTiers } from "../planner/AnalyticsTiers.ts";
import { AnalyticsWindow } from "../planner/AnalyticsWindow.ts";
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
 * One array per retention tier, as the relational provider has one table per
 * tier, so a boundary-spanning query can be tested with no database.
 */
export class MemoryAnalyticsProvider extends AnalyticsProvider {
  public readonly exact: boolean = true;

  /**
   * Each dataset's rows, one array per tier of its chain.
   */
  protected readonly stored = new Map<string, AnalyticsRow[][]>();

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
    this.mergeInto(dataset, this.tiers(dataset)[0], rows);
  }

  /**
   * Merges `rows` into `tier`, each into the row holding the same key, as a
   * relational upsert does, so a gauge's extremes and last value fold on
   * write here too.
   */
  protected mergeInto(
    dataset: AnalyticsDataset,
    tier: AnalyticsRow[],
    rows: AnalyticsRow[],
  ): void {
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const index = new Map(
      tier.map((row) => [AnalyticsRowFolder.key(dimensions, row), row]),
    );
    for (const row of rows) {
      const key = AnalyticsRowFolder.key(dimensions, row);
      const target = index.get(key);
      if (target) {
        AnalyticsFolds.merge(dataset, target, row);
      } else {
        const copy = { ...row };
        tier.push(copy);
        index.set(key, copy);
      }
    }
  }

  /**
   * The dataset's tier arrays, created on first use.
   */
  protected tiers(dataset: AnalyticsDataset): AnalyticsRow[][] {
    let tiers = this.stored.get(dataset.name);
    if (!tiers) {
      tiers = AnalyticsTiers.of(dataset).map(() => []);
      this.stored.set(dataset.name, tiers);
    }
    return tiers;
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

    // Each tier reads its own key range (see `AnalyticsWindow`), and a
    // matching row in a bucket that straddles a bound coarsens the result.
    const specs = AnalyticsTiers.of(dataset);
    let coarsened = false;
    const rows = this.tiers(dataset).flatMap((tier, index) => {
      const bounds = AnalyticsWindow.forTier(query, specs[index].resolution);
      return tier.filter((row) => {
        if (row.hour < bounds.lower) return false;
        if (bounds.upper !== undefined && row.hour >= bounds.upper) {
          return false;
        }
        if (!this.matches(row, query)) return false;
        if (bounds.straddling.includes(row.hour)) coarsened = true;
        return true;
      });
    });

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

    return { rows: out, estimated: false, coarsened };
  }

  public async rollup(
    dataset: AnalyticsDataset,
    fromTier: AnalyticsTier,
    before: string,
  ): Promise<void> {
    const tiers = this.tiers(dataset);
    const source = tiers[fromTier];
    const target = tiers[fromTier + 1];
    if (!source || !target) return;

    const resolution = AnalyticsTiers.of(dataset)[fromTier + 1].resolution;
    const boundary = AnalyticsBuckets.truncate(before, resolution);
    const folded: AnalyticsRow[] = [];
    const kept: AnalyticsRow[] = [];
    for (const row of source) {
      if (row.hour < boundary) {
        folded.push({
          ...row,
          hour: AnalyticsBuckets.truncate(row.hour, resolution),
        });
      } else {
        kept.push(row);
      }
    }

    tiers[fromTier] = kept;
    this.mergeInto(dataset, target, folded);
  }

  public async prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    const tiers = this.tiers(dataset);
    for (let index = 0; index < tiers.length; index++) {
      tiers[index] = tiers[index].filter((row) => row.hour >= before);
    }
  }

  public async oldestBucket(
    dataset: AnalyticsDataset,
    tier: AnalyticsTier,
  ): Promise<string | undefined> {
    let oldest: string | undefined;
    for (const row of this.tiers(dataset)[tier] ?? []) {
      if (oldest === undefined || row.hour < oldest) oldest = row.hour;
    }
    return oldest;
  }

  protected dimensionOf(row: AnalyticsRow, name: string): string | number {
    if (name === "day") return AnalyticsBuckets.day(row.hour);
    // The stored key itself; a rolled row answers with its day key.
    if (name === "minute") return row.hour;
    if (name === "hour") return row.hour.slice(0, 13);
    return row[name] as string | number;
  }

  /**
   * Whether `row` passes the query's dimension filters. The time window is
   * applied per tier by the caller.
   */
  protected matches(row: AnalyticsRow, query: AnalyticsQuery): boolean {
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
