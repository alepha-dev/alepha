import type { Static, TKeysToIndexer, TObject, TPick } from "@alepha/core";
import type { PgQueryWhereOrSQL } from "./PgQueryWhere.ts";

/**
 * Order direction for sorting
 */
export type OrderDirection = "asc" | "desc";

/**
 * Single order by clause with column and direction
 */
export interface OrderByClause<T> {
	column: keyof T;
	direction?: OrderDirection;
}

/**
 * Order by parameter - supports 3 modes:
 * 1. String: orderBy: "name" (defaults to ASC)
 * 2. Single object: orderBy: { column: "name", direction: "desc" }
 * 3. Array: orderBy: [{ column: "name", direction: "asc" }, { column: "age", direction: "desc" }]
 */
export type OrderBy<T> = keyof T | OrderByClause<T> | Array<OrderByClause<T>>;

export interface PgQuery<T extends TObject> {
	distinct?: boolean;
	where?: PgQueryWhereOrSQL<Static<T>>;
	limit?: number;
	offset?: number;
	orderBy?: OrderBy<Static<T>>;
	groupBy?: (keyof Static<T>)[];
}

export type PgQueryResult<
	T extends TObject,
	Select extends (keyof Static<T>)[],
> = TPick<T, TKeysToIndexer<Select>>;
