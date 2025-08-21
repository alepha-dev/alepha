import type { Static, TObject, TPick } from "@sinclair/typebox";
import type { PgQueryWhereOrSQL } from "./PgQueryWhere.ts";

export interface PgQuery<
	T extends TObject,
	Select extends (keyof Static<T>)[] = [],
> {
	columns?: Select;
	distinct?: boolean;
	where?: PgQueryWhereOrSQL<Static<T>>;
	limit?: number;
	offset?: number;
	sort?: {
		[key in keyof Static<T>]?: "asc" | "desc";
	};
	groupBy?: (keyof Static<T>)[];
}

export type PgQueryResult<
	T extends TObject,
	Select extends (keyof Static<T>)[],
> = TPick<T, Select>;
