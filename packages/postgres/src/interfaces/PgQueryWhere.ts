import type { Static, TArray, TObject, TOptionalAdd } from "@alepha/core";
import type { SQLWrapper } from "drizzle-orm";
import {
	PG_MANY,
	PG_ONE,
	type PgDefault,
	type PgOne,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import type { FilterOperators } from "./FilterOperators.ts";

export type PgQueryWhere<T extends TObject> = {
	[Key in keyof Static<T>]?: FilterOperators<Static<T>[Key]> | Static<T>[Key];
} & {
	/**
	 * Combine a list of conditions with the `and` operator. Conditions
	 * that are equal `undefined` are automatically ignored.
	 *
	 * ## Examples
	 *
	 * ```ts
	 * db.select().from(cars)
	 *   .where(
	 *     and(
	 *       eq(cars.make, 'Volvo'),
	 *       eq(cars.year, 1950),
	 *     )
	 *   )
	 * ```
	 */
	and?: Array<PgQueryWhereOrSQL<T>>;

	/**
	 * Combine a list of conditions with the `or` operator. Conditions
	 * that are equal `undefined` are automatically ignored.
	 *
	 * ## Examples
	 *
	 * ```ts
	 * db.select().from(cars)
	 *   .where(
	 *     or(
	 *       eq(cars.make, 'GM'),
	 *       eq(cars.make, 'Ford'),
	 *     )
	 *   )
	 * ```
	 */
	or?: Array<PgQueryWhereOrSQL<T>>;

	/**
	 * Negate the meaning of an expression using the `not` keyword.
	 *
	 * ## Examples
	 *
	 * ```ts
	 * // Select cars _not_ made by GM or Ford.
	 * db.select().from(cars)
	 *   .where(not(inArray(cars.make, ['GM', 'Ford'])))
	 * ```
	 */
	not?: PgQueryWhereOrSQL<T>;

	/**
	 * Test whether a subquery evaluates to have any rows.
	 *
	 * ## Examples
	 *
	 * ```ts
	 * // Users whose `homeCity` column has a match in a cities
	 * // table.
	 * db
	 *   .select()
	 *   .from(users)
	 *   .where(
	 *     exists(db.select()
	 *       .from(cities)
	 *       .where(eq(users.homeCity, cities.id))),
	 *   );
	 * ```
	 *
	 * @see notExists for the inverse of this test
	 */
	exists?: SQLWrapper;
};

export type PgQueryWhereOrSQL<T extends TObject> = SQLWrapper | PgQueryWhere<T>;

export type PgQueryWhereWithManyOrSQL<T extends TObject> =
	| SQLWrapper
	| PgQueryWhereWithMany<T>;

export type PgQueryWhereWithMany<T extends TObject> = PgQueryWhere<
	RemoveManyRelations<T>
> &
	ExtractManyRelations<T>;

export type RelField =
	| {
			[PG_MANY]: any;
	  }
	| {
			[PG_ONE]: any;
	  };

export type ExtractManyRelations<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends RelField
		? T["properties"][K] extends TArray
			? T["properties"][K]["items"] extends TObject
				? K
				: never
			: never
		: T["properties"][K] extends TObject
			? K
			: never]?: PgQueryWhere<
		T["properties"][K] extends TArray
			? T["properties"][K]["items"] extends TObject
				? T["properties"][K]["items"]
				: TObject
			: T["properties"][K] extends TObject
				? T["properties"][K]
				: TObject
	>;
};

export type RemoveManyRelations<T extends TObject> = TObject<{
	[K in keyof T["properties"] as T["properties"][K] extends RelField
		? never
		: K]: T["properties"][K];
}>;

export type PgQueryWithMap<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends RelField
		? K
		: never]?: T["properties"][K] extends TArray
		? T["properties"][K]["items"] extends TObject
			? PgQueryWithMany<T["properties"][K]["items"]>
			: never
		: T["properties"][K] extends TObject
			? PgQueryWithOne<T["properties"][K]>
			: T["properties"][K] extends PgAttr<
						PgAttr<TOptionalAdd<infer U>, PgOne>,
						PgDefault
					>
				? U extends TObject
					? PgQueryWithOne<U>
					: never
				: never;
};

export type PgQueryWithOne<T extends TObject> =
	| true
	| {
			// limit?: number;
			// offset?: number;
			// sort?:
			columns?: (keyof Static<T>)[];
			relations?: PgQueryWithMap<T>;
	  };

export type PgQueryWithMany<T extends TObject> =
	| true
	| {
			limit?: number;
			// offset?: number;
			// sort?:
			columns?: (keyof Static<T>)[];
			relations?: PgQueryWithMap<T>;
	  };
