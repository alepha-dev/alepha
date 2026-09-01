import type { Infer, ZObject } from "alepha";

import type { PgQueryWhereOrSQL } from "./PgQueryWhere.ts";

export type AggregateOp = "count" | "sum" | "avg" | "min" | "max";

/**
 * How ONE aggregate operation is computed.
 *
 * `true` is the plain form: aggregate the key's own column, over every row
 * the query's `where` admitted.
 *
 * The object form adds two things, and either may be used alone:
 *
 * - `column` names the column to aggregate instead of the key. Supplying it
 *   turns the key into an **alias**, which is what lets several
 *   differently-conditioned aggregates over the same column coexist.
 * - `where` conditions the aggregate: it compiles into
 *   `COUNT(CASE WHEN <where> THEN <column> END)`, so only the matching rows
 *   contribute.
 *
 * ⚠️ `where` NARROWS, it never widens. It is ANDed inside the CASE while the
 * query's own `where` - carrying the tenant scoping and the soft-delete
 * filter - still governs which rows the aggregate sees at all.
 *
 * ⚠️ `COUNT(CASE WHEN c THEN col END)` also skips NULLs of `col` itself,
 * because that is what `COUNT(col)` does. For "how many rows match the
 * condition", point `column` at a column that is never null, such as the
 * primary key. Pointing it at a nullable column asks a different question -
 * a useful one, but a different one.
 */
export type AggregateOpSelect<T extends ZObject> =
  | true
  | {
      column?: keyof Infer<T>;
      where?: PgQueryWhereOrSQL<T>;
    };

/**
 * Select definition for aggregate queries.
 * - `true` means select the column value as-is (used for groupBy columns).
 * - `{ sum: true, avg: true, ... }` means compute those aggregations.
 * - `{ count: { column, where } }` conditions or re-points one of them.
 */
export type AggregateColumnSelect<T extends ZObject> =
  | true
  | Partial<Record<AggregateOp, AggregateOpSelect<T>>>;

/**
 * The keys of an aggregate select.
 *
 * A key is either a **column name** - and then nothing under it may carry
 * `column` - or a free-form **alias**, and then every operation under it
 * must. The rule is enforced at runtime by `Repository.aggregate`, with the
 * key named in the error, because the two readings of a misspelt column are
 * "you meant a column" and "you meant an alias" and only the caller knows
 * which.
 *
 * An alias may not be spelled like one of the entity's own columns: it would
 * shadow it silently in the result.
 */
export type AggregateSelect<T extends ZObject> = {
  [K in keyof Infer<T>]?: AggregateColumnSelect<T>;
} & {
  [alias: string]: AggregateColumnSelect<T> | undefined;
};

/**
 * The type one aggregate operation produces over a column of type `TValue`.
 *
 * `count`, `sum` and `avg` are numbers whatever the column holds. `min` and
 * `max` are the column's OWN type: the maximum of a date column is a date and
 * of a text column a string, and calling either of those a number is how they
 * became `NaN`.
 */
export type AggregateOpValue<Op extends AggregateOp, TValue> = Op extends
  | "count"
  | "sum"
  | "avg"
  ? number
  : TValue;

/**
 * Which column an operation actually reads: the one `column` names when it is
 * present, otherwise the one the key names.
 */
export type AggregateSourceValue<T extends ZObject, K, TSpec> = TSpec extends {
  column: infer C;
}
  ? C extends keyof Infer<T>
    ? Infer<T>[C]
    : unknown
  : K extends keyof Infer<T>
    ? Infer<T>[K]
    : unknown;

/**
 * Maps a single key's select definition to its result type.
 * - `true` → original column type
 * - `{ sum: true, avg: true }` → `{ sum: number; avg: number }`
 * - `{ max: true }` on a date column → `{ max: Date | null }`
 * - `{ count: { column: "id", where } }` → `{ count: number }`
 *
 * `min` / `max` carry `null` because SQL does: over an empty set they have no
 * answer. `count` / `sum` / `avg` are reported as `0` there instead, which is
 * the answer callers have always been given - and a conditioned count that
 * matches nothing lands on that same `0`.
 */
export type AggregateColumnResult<
  T extends ZObject,
  K,
  TSelect,
> = TSelect extends true
  ? K extends keyof Infer<T>
    ? Infer<T>[K]
    : unknown
  : {
      [
        Op in AggregateOp as TSelect extends Record<Op, AggregateOpSelect<T>>
          ? Op
          : never
      ]: Op extends "count" | "sum" | "avg"
        ? number
        :
            | (TSelect extends Record<Op, infer TSpec>
                ? AggregateSourceValue<T, K, TSpec>
                : never)
            | null;
    };

/**
 * Result type for an aggregate query.
 */
export type AggregateResult<T extends ZObject, S extends AggregateSelect<T>> = {
  [K in keyof S]: AggregateColumnResult<T, K, NonNullable<S[K]>>;
};

/**
 * HAVING clause for aggregate queries.
 * Only applies to keys with aggregate operations (not `true`).
 */
export type AggregateHaving<T extends ZObject, S extends AggregateSelect<T>> = {
  [K in keyof S]?: S[K] extends true
    ? never
    : {
        [
          Op in AggregateOp as NonNullable<S[K]> extends Record<
            Op,
            AggregateOpSelect<T>
          >
            ? Op
            : never
        ]?: {
          gt?: AggregateHavingValue<T, K, S[K], Op>;
          gte?: AggregateHavingValue<T, K, S[K], Op>;
          lt?: AggregateHavingValue<T, K, S[K], Op>;
          lte?: AggregateHavingValue<T, K, S[K], Op>;
          eq?: AggregateHavingValue<T, K, S[K], Op>;
          ne?: AggregateHavingValue<T, K, S[K], Op>;
        };
      };
};

/**
 * What a HAVING comparison is compared against: a number for the numeric
 * aggregates, the read column's own type for `min` / `max`.
 */
export type AggregateHavingValue<
  T extends ZObject,
  K,
  TSelect,
  Op extends AggregateOp,
> = Op extends "count" | "sum" | "avg"
  ? number
  : TSelect extends Record<Op, infer TSpec>
    ? AggregateSourceValue<T, K, TSpec>
    : never;

/**
 * Full aggregate query definition.
 */
export interface AggregateQuery<
  T extends ZObject,
  S extends AggregateSelect<T>,
> {
  /**
   * Columns and aggregate operations to select.
   */
  select: S;

  /**
   * WHERE clause to filter rows before aggregation.
   *
   * This is the ONLY place tenancy and soft-delete scoping is applied, and a
   * per-aggregate `where` never replaces it - see {@link AggregateOpSelect}.
   */
  where?: PgQueryWhereOrSQL<T>;

  /**
   * Columns to group by. Always real columns, never a select alias.
   */
  groupBy?: (keyof Infer<T>)[];

  /**
   * HAVING clause to filter groups after aggregation.
   */
  having?: AggregateHaving<T, S>;

  /**
   * Order results. Supports dot notation for aggregate columns (e.g. "amount.sum").
   */
  orderBy?:
    | string
    | { column: string; direction: "asc" | "desc" }
    | Array<{ column: string; direction: "asc" | "desc" }>;

  /**
   * Limit the number of results.
   */
  limit?: number;

  /**
   * Offset for pagination.
   */
  offset?: number;
}
