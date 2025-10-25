import type { Static, TObject } from "@alepha/core";
import type { SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PgTableWithColumnsAndSchema } from "../descriptors/$entity.ts";
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
export interface PgQuery<T extends TObject = TObject> {
  distinct?: (keyof Static<T>)[];
  columns?: (keyof Static<T>)[];
  where?: PgQueryWhereOrSQL<T>;
  limit?: number;
  offset?: number;
  orderBy?: OrderBy<Static<T>>;
  groupBy?: (keyof Static<T>)[];
}

export type PgStatic<
  T extends TObject,
  Relations extends PgRelationMap<T>,
> = Static<T> & {
  [K in keyof Relations]: Static<Relations[K]["join"]["$schema"]> &
    (Relations[K]["with"] extends PgRelationMap<TObject>
      ? PgStatic<Relations[K]["join"]["$schema"], Relations[K]["with"]>
      : {});
};

export interface PgQueryRelations<
  T extends TObject = TObject,
  Relations extends PgRelationMap<T> | undefined = undefined,
> extends PgQuery<T> {
  with?: Relations;
  where?: PgQueryWhereOrSQL<T, Relations>;
}

export type PgRelationMap<Base extends TObject> = Record<
  string,
  PgRelation<Base>
>;

export type PgRelation<Base extends TObject> = {
  type?: "left" | "inner" | "right";
  join: PgTableWithColumnsAndSchema<any, TObject>;
  on: SQLWrapper | [keyof Static<Base>, PgColumn];
  with?: PgRelationMap<TObject>;
};
