import type { Static, TObject } from "alepha";
import type { SQLWrapper } from "drizzle-orm";
import type { FilterOperators } from "./FilterOperators.ts";
import type { PgRelationMap } from "./PgQuery.ts";

export type PgQueryWhere<
  T extends TObject,
  Relations extends PgRelationMap<TObject> | undefined = undefined,
> =
  | (PgQueryWhereOperators<T> & PgQueryWhereConditions<T>)
  | (PgQueryWhereRelations<Relations> &
      PgQueryWhereOperators<T> &
      PgQueryWhereConditions<T, Relations>);

export type PgQueryWhereOrSQL<
  T extends TObject,
  Relations extends PgRelationMap<TObject> | undefined = undefined,
> = SQLWrapper | PgQueryWhere<T, Relations>;

// ---------------------------------------------------------------------------------------------------------------------

type PgQueryWhereOperators<T extends TObject> = {
  [Key in keyof Static<T>]?: FilterOperators<Static<T>[Key]> | Static<T>[Key];
};

type PgQueryWhereConditions<
  T extends TObject,
  Relations extends PgRelationMap<TObject> | undefined = undefined,
> = {
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
  and?: Array<PgQueryWhereOrSQL<T, Relations>>;

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
  or?: Array<PgQueryWhereOrSQL<T, Relations>>;

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
  not?: PgQueryWhereOrSQL<T, Relations>;

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

  /**
   * Test whether a subquery evaluates to have no rows.
   *
   * @see exists for the inverse of this test
   */
  notExists?: SQLWrapper;
};

type PgQueryWhereRelations<
  Relations extends PgRelationMap<TObject> | undefined = undefined,
> =
  Relations extends PgRelationMap<TObject>
    ? {
        [K in keyof Relations]?: PgQueryWhere<
          Relations[K]["join"]["schema"],
          Relations[K]["with"]
        >;
      }
    : {};
