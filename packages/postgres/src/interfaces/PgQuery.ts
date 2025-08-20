import type { Static, TObject, TPick } from "@sinclair/typebox";
import type { SQLWrapper } from "drizzle-orm";
import type { PgQueryWhere } from "./PgQueryWhere.ts";

export interface PgQuery<
	T extends TObject,
	Select extends (keyof Static<T>)[] = [],
> {
	columns?: Select;
	distinct?: boolean;
	where?: PgQueryWhere<Static<T>> | SQLWrapper;
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
