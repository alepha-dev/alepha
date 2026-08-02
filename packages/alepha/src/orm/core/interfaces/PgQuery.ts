import type { Infer, ZObject } from "alepha";
import type { SQLWrapper } from "drizzle-orm";
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

/**
 * Generic query interface for PostgreSQL entities
 */
export interface PgQuery<T extends ZObject = ZObject> {
  distinct?: (keyof Infer<T>)[];
  columns?: (keyof Infer<T>)[];
  where?: PgQueryWhereOrSQL<T>;
  limit?: number;
  offset?: number;
  orderBy?: OrderBy<Infer<T>>;
  groupBy?: (keyof Infer<T>)[];
}

export type PgStatic<
  T extends ZObject,
  Relations extends PgRelationMap<T>,
> = Infer<T> & {
  [K in keyof Relations]: Infer<Relations[K]["join"]["schema"]> &
    (Relations[K]["with"] extends PgRelationMap<ZObject>
      ? PgStatic<Relations[K]["join"]["schema"], Relations[K]["with"]>
      : {});
};

export interface PgQueryRelations<
  T extends ZObject = ZObject,
  Relations extends PgRelationMap<T> | undefined = undefined,
> extends PgQuery<T> {
  with?: Relations;
  where?: PgQueryWhereOrSQL<T, Relations>;
}

export type PgRelationMap<Base extends ZObject> = Record<
  string,
  PgRelation<Base>
>;

type TObjectAny = ZObject<any>;

export type PgRelation<Base extends ZObject> = {
  type?: "left" | "inner" | "right";
  join: {
    schema: ZObject;
    name: string;
  };
  // `readonly` so a literal tuple written with `as const` (the natural
  // shape for `["userId", users.cols.id]`) satisfies the type without an
  // explicit cast. The relation manager only reads the indices.
  on:
    | SQLWrapper
    | readonly [
        keyof Infer<Base>,
        {
          name: string;
        },
      ];
  with?: PgRelationMap<ZObject>;
};
