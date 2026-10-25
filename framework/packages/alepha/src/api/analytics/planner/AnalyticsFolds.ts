import { AlephaError } from "alepha";

import type { AnalyticsRow } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsFold,
  AnalyticsQuery,
} from "../schemas/analyticsQuerySchema.ts";

/**
 * One stored column of a measure.
 */
export interface AnalyticsColumn {
  measure: string;
  fold: AnalyticsFold;
  /**
   * The stored name: the measure itself for a sum-only measure,
   * `<measure>_<fold>` otherwise.
   */
  name: string;
}

/**
 * One value a query asked for: which measure, which fold, under which key it
 * comes back, and which stored column holds it.
 */
export interface AnalyticsSelection extends AnalyticsColumn {
  key: string;
}

/**
 * The fold rules of a dataset: which columns a measure is stored in, and how
 * two values of one column combine.
 *
 * Every combination treats a missing reading (`null` or `undefined`) as
 * absent, never as `0`: a `min` that met one empty row would otherwise be
 * pinned at `0` forever. The memory provider, the pre-fold and the
 * relational query merge all combine through here, so they agree by
 * construction; the relational upsert and rollup spell the same rules in SQL.
 *
 * Pure and static, like `AnalyticsBuckets`.
 */
export class AnalyticsFolds {
  public static readonly ALL: readonly AnalyticsFold[] = [
    "sum",
    "min",
    "max",
    "last",
  ];

  /**
   * The folds `measure` declares; `["sum"]` when it declares none.
   */
  public static of(
    dataset: AnalyticsDataset,
    measure: string,
  ): AnalyticsFold[] {
    return dataset.folds?.[measure] ?? ["sum"];
  }

  /**
   * Whether `measure` folds `sum` alone, and so keeps the single column
   * named after itself that every dataset had before folds existed.
   */
  public static isSumOnly(dataset: AnalyticsDataset, measure: string): boolean {
    const folds = AnalyticsFolds.of(dataset, measure);
    return folds.length === 1 && folds[0] === "sum";
  }

  /**
   * Whether the dataset declares any fold a sampled backend cannot
   * reconstruct.
   */
  public static needsExact(dataset: AnalyticsDataset): boolean {
    return Object.keys(dataset.measures.shape).some(
      (measure) => !AnalyticsFolds.isSumOnly(dataset, measure),
    );
  }

  public static column(
    dataset: AnalyticsDataset,
    measure: string,
    fold: AnalyticsFold,
  ): string {
    return AnalyticsFolds.isSumOnly(dataset, measure)
      ? measure
      : `${measure}_${fold}`;
  }

  /**
   * The column holding the `at` of a measure's `last` value.
   */
  public static lastAt(measure: string): string {
    return `${measure}_last_at`;
  }

  /**
   * Every value column of the dataset, measure by measure. The `last_at`
   * companions are not in this list: see {@link lastAt}.
   */
  public static columns(dataset: AnalyticsDataset): AnalyticsColumn[] {
    return Object.keys(dataset.measures.shape).flatMap((measure) =>
      AnalyticsFolds.of(dataset, measure).map((fold) => ({
        measure,
        fold,
        name: AnalyticsFolds.column(dataset, measure, fold),
      })),
    );
  }

  /**
   * Every stored name the measures produce, `last_at` companions included.
   * What the collision check compares the declared names against.
   */
  public static storedNames(dataset: AnalyticsDataset): string[] {
    const names: string[] = [];
    for (const column of AnalyticsFolds.columns(dataset)) {
      names.push(column.name);
      if (column.fold === "last")
        names.push(AnalyticsFolds.lastAt(column.measure));
    }
    return names;
  }

  /**
   * Refuses a `folds` declaration naming an undeclared measure, an unknown
   * fold, no fold at all, or the same fold twice.
   */
  public static assertValid(dataset: AnalyticsDataset): void {
    for (const [measure, folds] of Object.entries(dataset.folds ?? {})) {
      if (!Object.hasOwn(dataset.measures.shape, measure)) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares folds for '${measure}', which is not a declared measure.`,
        );
      }
      if (!Array.isArray(folds) || folds.length === 0) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares no fold for '${measure}'. Omit it to fold ["sum"].`,
        );
      }
      for (const fold of folds) {
        if (!AnalyticsFolds.ALL.includes(fold)) {
          throw new AlephaError(
            `Dataset '${dataset.name}' declares an unknown fold '${fold}' for '${measure}'. Known folds: ${AnalyticsFolds.ALL.join(", ")}.`,
          );
        }
      }
      if (new Set(folds).size !== folds.length) {
        throw new AlephaError(
          `Dataset '${dataset.name}' declares a fold twice for '${measure}'.`,
        );
      }
    }
  }

  /**
   * Resolves a query's `select` into the values to read, refusing an
   * undeclared measure or a fold the measure does not declare.
   */
  public static selections(
    dataset: AnalyticsDataset,
    select: AnalyticsQuery["select"],
  ): AnalyticsSelection[] {
    const out: AnalyticsSelection[] = [];
    for (const [measure, value] of Object.entries(select)) {
      if (!Object.hasOwn(dataset.measures.shape, measure)) {
        throw new AlephaError(
          `Query on dataset '${dataset.name}' references '${measure}', which is not a declared measure. Declared measures: ${Object.keys(dataset.measures.shape).join(", ") || "(none)"}.`,
        );
      }
      const many = Array.isArray(value);
      const folds = many ? value : [value];
      if (folds.length === 0) {
        throw new AlephaError(
          `Query on dataset '${dataset.name}' selects no fold for '${measure}'.`,
        );
      }
      const declared = AnalyticsFolds.of(dataset, measure);
      for (const fold of folds) {
        if (!declared.includes(fold)) {
          throw new AlephaError(
            `Query on dataset '${dataset.name}' asks for '${fold}' of '${measure}', which declares ${declared.map((f) => `'${f}'`).join(", ")} only.`,
          );
        }
        out.push({
          measure,
          fold,
          key: many ? `${measure}_${fold}` : measure,
          name: AnalyticsFolds.column(dataset, measure, fold),
        });
      }
    }
    return out;
  }

  /**
   * One recorded reading in stored form: every column of every measure, a
   * gauge the row omits stored as `null`.
   *
   * A sum-only measure keeps today's behaviour, `0` when omitted, so its
   * single column stays non-null.
   */
  public static toStored(
    dataset: AnalyticsDataset,
    row: Record<string, unknown> & { hour: string },
    at: number,
  ): AnalyticsRow {
    const stored: AnalyticsRow = { hour: row.hour };
    for (const name of Object.keys(dataset.dimensions.shape)) {
      stored[name] = row[name] as string | number;
    }
    for (const measure of Object.keys(dataset.measures.shape)) {
      const raw = row[measure];
      if (AnalyticsFolds.isSumOnly(dataset, measure)) {
        stored[measure] = Number(raw ?? 0);
        continue;
      }
      const value = raw === undefined || raw === null ? null : Number(raw);
      for (const fold of AnalyticsFolds.of(dataset, measure)) {
        stored[`${measure}_${fold}`] = value;
      }
      if (AnalyticsFolds.of(dataset, measure).includes("last")) {
        stored[AnalyticsFolds.lastAt(measure)] = value === null ? null : at;
      }
    }
    return stored;
  }

  /**
   * Folds stored row `source` into stored row `target`, in place: the same
   * merge an upsert performs on a conflict and a rollup performs on a group.
   */
  public static merge(
    dataset: AnalyticsDataset,
    target: AnalyticsRow,
    source: AnalyticsRow,
  ): void {
    for (const column of AnalyticsFolds.columns(dataset)) {
      if (column.fold === "last") {
        const at = AnalyticsFolds.lastAt(column.measure);
        if (
          AnalyticsFolds.laterWins(
            target[column.name],
            target[at],
            source[column.name],
            source[at],
          )
        ) {
          target[column.name] = source[column.name];
          target[at] = source[at];
        }
        continue;
      }
      if (AnalyticsFolds.isSumOnly(dataset, column.measure)) {
        target[column.name] =
          Number(target[column.name] ?? 0) + Number(source[column.name] ?? 0);
        continue;
      }
      target[column.name] = AnalyticsFolds.combine(
        column.fold,
        target[column.name],
        source[column.name],
      );
    }
  }

  /**
   * Two values of one `sum`, `min` or `max`, a missing one counting as
   * absent: `null` only when both are missing.
   */
  public static combine(
    fold: Exclude<AnalyticsFold, "last">,
    left: unknown,
    right: unknown,
  ): number | null {
    const a = AnalyticsFolds.reading(left);
    const b = AnalyticsFolds.reading(right);
    if (a === null) return b;
    if (b === null) return a;
    if (fold === "min") return Math.min(a, b);
    if (fold === "max") return Math.max(a, b);
    return a + b;
  }

  /**
   * Whether the `last` value on the right replaces the one on the left: it
   * was taken later, or at the same instant and is larger. The tie-break is
   * what lets every backend agree on one value.
   */
  public static laterWins(
    leftValue: unknown,
    leftAt: unknown,
    rightValue: unknown,
    rightAt: unknown,
  ): boolean {
    const rv = AnalyticsFolds.reading(rightValue);
    const ra = AnalyticsFolds.reading(rightAt);
    if (rv === null || ra === null) return false;
    const lv = AnalyticsFolds.reading(leftValue);
    const la = AnalyticsFolds.reading(leftAt);
    if (lv === null || la === null) return true;
    return ra > la || (ra === la && rv > lv);
  }

  /**
   * A stored value as a number, or `null` for a missing reading. Drivers
   * return a bigint column as a string on some paths, hence `Number`.
   */
  public static reading(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    return Number(value);
  }
}
