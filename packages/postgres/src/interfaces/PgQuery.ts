import type { Static, TArray, TObject } from "@sinclair/typebox";
import type { SQLWrapper } from "drizzle-orm";
import type { PG_MANY } from "../constants/PG_SYMBOLS";
import type { PgQueryWhere } from "./PgQueryWhere";

export interface PgQuery<T extends TObject> {
	where?: PgQueryWhereWithMany<T> | SQLWrapper;
	limit?: number;
	offset?: number;
	sort?: {
		[key in keyof Static<T>]?: "asc" | "desc";
	};
	relations?: PgQueryWithMap<T>;
}

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
			relations?: {
				[key: string]: PgQueryWith<T>;
			};
	  };
