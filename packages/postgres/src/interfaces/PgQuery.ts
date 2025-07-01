import type { Static, TArray, TObject, TPick } from "@sinclair/typebox";
import type { SQLWrapper } from "drizzle-orm";
import type { PG_MANY } from "../constants/PG_SYMBOLS.ts";
import type { PgQueryWhere } from "./PgQueryWhere.ts";

export interface PgQuery<
	T extends TObject,
	Select extends (keyof Static<T>)[] = [],
> {
	columns?: Select;
	distinct?: boolean;
	where?: PgQueryWhereWithMany<T> | SQLWrapper;
	limit?: number;
	offset?: number;
	sort?: {
		[key in keyof Static<T>]?: "asc" | "desc";
	};
	groupBy?: (keyof Static<T>)[];
	relations?: PgQueryWithMap<T>;
}

export type PgQueryResult<
	T extends TObject,
	Select extends (keyof Static<T>)[],
> = TPick<T, Select>;

export type PgQueryWhereWithMany<T extends TObject> = PgQueryWhere<
	Static<RemoveManyRelations<T>>
> &
	ExtractManyRelations<T>;

export type ExtractManyRelations<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends {
		[PG_MANY]: any;
	}
		? T["properties"][K] extends TArray
			? T["properties"][K]["items"] extends TObject
				? K
				: never
			: never
		: never]?: PgQueryWhere<Static<T["properties"][K]["items"]>>;
};

export type RemoveManyRelations<T extends TObject> = TObject<{
	[K in keyof T["properties"] as T["properties"][K] extends {
		[PG_MANY]: any;
	}
		? never
		: K]: T["properties"][K];
}>;

export type PgQueryWithMap<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends {
		[PG_MANY]: any;
	}
		? K
		: never]?: T["properties"][K] extends TObject
		? PgQueryWith<T["properties"][K]>
		: T["properties"][K] extends TArray
			? PgQueryWith<T["properties"][K]>
			: never;
};

export type PgQueryWith<T extends TObject | TArray> =
	| true
	| {
			// limit?: number;
			// offset?: number;
			// sort?:
			// columns?: (keyof Static<T>)[];
			relations?: {
				[key: string]: PgQueryWith<T>;
			};
	  };
