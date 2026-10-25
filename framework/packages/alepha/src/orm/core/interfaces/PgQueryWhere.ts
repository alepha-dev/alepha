import type { Infer, ZObject } from "alepha";
import type { SQL } from "drizzle-orm";

import type { FilterOperators } from "./FilterOperators.ts";
import type { PgRelationMap } from "./PgQuery.ts";

export type PgQueryWhere<
  T extends ZObject,
  Relations extends PgRelationMap<ZObject> | undefined = undefined,
> =
  | (PgQueryWhereOperators<T> & PgQueryWhereConditions<T>)
  | (PgQueryWhereRelations<Relations> &
      PgQueryWhereOperators<T> &
      PgQueryWhereConditions<T, Relations>);

export type PgQueryWhereOrSQL<
  T extends ZObject,
  Relations extends PgRelationMap<ZObject> | undefined = undefined,
> = SQL | PgQueryWhere<T, Relations>;

// ---------------------------------------------------------------------------------------------------------------------

type PgQueryWhereOperators<T extends ZObject> = {
  [Key in keyof Infer<T>]?: FilterOperators<Infer<T>[Key]> | Infer<T>[Key];
};

type PgQueryWhereConditions<
  T extends ZObject,
  Relations extends PgRelationMap<ZObject> | undefined = undefined,
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
   * Build the subquery with `repository.subquery(where)`: it compiles a
   * where-object against the other table, soft-delete filter included, and a
   * column of the outer table as a comparison value correlates it.
   *
   * ## Examples
   *
   * ```ts
   * // Users whose `homeCity` has a match in the cities table.
   * await users.findMany({
   *   where: {
   *     exists: cities.subquery({ id: { eq: users.table.homeCity } }),
   *   },
   * });
   * ```
   *
   * @see notExists for the inverse of this test
   */
  exists?: SQL;

  /**
   * Test whether a subquery evaluates to have no rows.
   *
   * ## Examples
   *
   * ```ts
   * // Epics with no open quest left.
   * await epics.findMany({
   *   where: {
   *     notExists: quests.subquery({
   *       epicId: { eq: epics.table.id },
   *       completedAt: { isNull: true },
   *     }),
   *   },
   * });
   * ```
   *
   * @see exists for the inverse of this test
   */
  notExists?: SQL;
};

type PgQueryWhereRelations<
  Relations extends PgRelationMap<ZObject> | undefined = undefined,
> =
  Relations extends PgRelationMap<ZObject>
    ? {
        [K in keyof Relations]?: PgQueryWhere<
          Relations[K]["join"]["schema"],
          Relations[K]["with"]
        >;
      }
    : {};
