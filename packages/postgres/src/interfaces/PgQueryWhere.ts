import type { SQL, SQLWrapper } from "drizzle-orm";
import type { FilterOperators } from "./FilterOperators.ts";

export type PgQueryWhere<T extends object> = {
	[Key in keyof T]?: FilterOperators<T[Key]>;
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
	and?: Array<PgQueryWhere<T> | SQL>;

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
	or?: Array<PgQueryWhere<T> | SQL>;

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
	not?: PgQueryWhere<T>;

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
