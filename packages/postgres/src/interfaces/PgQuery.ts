import type { Static, TObject } from "@alepha/core";
import type { WithRelations } from "../helpers/PgRelationManager.ts";
import type { PgQueryWhere } from "./PgQueryWhere.ts";

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

/**
 * Generic query interface for PostgreSQL entities
 */
export interface PgQuery<T extends TObject = TObject> {
	distinct?: boolean;
	where?: PgQueryWhere<T>;
	limit?: number;
	offset?: number;
	orderBy?: OrderBy<Static<T>>;
	groupBy?: (keyof Static<T>)[];
	with?: WithRelations;
}
