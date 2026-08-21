import type { Infer, ZObject } from "alepha";

import type { PgQueryWhereOrSQL } from "./PgQueryWhere.ts";

export type AggregateOp = "count" | "sum" | "avg" | "min" | "max";

/**
 * Select definition for aggregate queries.
 * - `true` means select the column value as-is (used for groupBy columns).
 * - `{ sum: true, avg: true, ... }` means compute those aggregations.
 */
export type AggregateColumnSelect = true | Partial<Record<AggregateOp, true>>;

export type AggregateSelect<T extends ZObject> = {
  [K in keyof Infer<T>]?: AggregateColumnSelect;
};

/**
 * Maps a single column's select definition to its result type.
 * - `true` → original column type
 * - `{ sum: true, avg: true }` → `{ sum: number; avg: number }`
 */
export type AggregateColumnResult<TValue, TSelect> = TSelect extends true
  ? TValue
  : {
      [
        Op in AggregateOp as TSelect extends Record<Op, true> ? Op : never
      ]: number;
    };

/**
 * Result type for an aggregate query.
 */
export type AggregateResult<T extends ZObject, S extends AggregateSelect<T>> = {
  [K in keyof S & keyof Infer<T>]: AggregateColumnResult<
    Infer<T>[K],
    NonNullable<S[K]>
  >;
};

/**
 * HAVING clause for aggregate queries.
 * Only applies to columns with aggregate operations (not `true`).
 */
export type AggregateHaving<T extends ZObject, S extends AggregateSelect<T>> = {
  [K in keyof S & keyof Infer<T>]?: S[K] extends true
    ? never
    : {
        [Op in AggregateOp as S[K] extends Record<Op, true> ? Op : never]?: {
          gt?: number;
          gte?: number;
          lt?: number;
          lte?: number;
          eq?: number;
          ne?: number;
        };
      };
};

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
   */
  where?: PgQueryWhereOrSQL<T>;

  /**
   * Columns to group by.
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
