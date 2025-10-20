import { $inject, type TObject } from "@alepha/core";
import {
  and,
  arrayContained,
  arrayContains,
  arrayOverlaps,
  between,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  isSQLWrapper,
  like,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notIlike,
  notInArray,
  notLike,
  or,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { FilterOperators } from "../interfaces/FilterOperators.ts";
import type {
  PgQueryWhere,
  PgQueryWhereOrSQL,
} from "../interfaces/PgQueryWhere.ts";
import { PgJsonQueryManager } from "./PgJsonQueryManager.ts";

export class PgQueryManager {
  protected readonly jsonQueryManager = $inject(PgJsonQueryManager);

  /**
   * Convert a query object to a SQL query.
   */
  public jsonQueryToSql(
    query: PgQueryWhereOrSQL<TObject>,
    schema: TObject,
    col: (key: string) => PgColumn,
  ): SQL | undefined {
    const conditions: SQL[] = [];

    if (isSQLWrapper(query)) {
      conditions.push(query as SQL);
    } else {
      const keys = Object.keys(query) as Array<
        keyof PgQueryWhere<TObject> & string
      >;

      for (const key of keys) {
        const operator = query[key] as SQL;

        if (Array.isArray(operator)) {
          const operations: SQL[] = operator
            .map((it) => {
              if (isSQLWrapper(it)) {
                return it as SQL;
              }
              return this.jsonQueryToSql(
                it as PgQueryWhere<TObject>,
                schema,
                col,
              );
            })
            .filter((it) => it != null);

          if (key === "and") {
            return and(...operations);
          }

          if (key === "or") {
            return or(...operations);
          }
        }

        if (key === "not") {
          const where = this.jsonQueryToSql(
            operator as PgQueryWhereOrSQL<TObject>,
            schema,
            col,
          );
          if (where) {
            return not(where);
          }
        }

        if (operator) {
          // Check if this is a JSONB column with nested query
          // BUT skip primitive arrays - they should use native Drizzle operators
          if (
            this.jsonQueryManager.isJsonbColumn(schema, key) &&
            !this.jsonQueryManager.isPrimitiveArray(schema, key) &&
            typeof operator === "object" &&
            !Array.isArray(operator) &&
            this.jsonQueryManager.hasNestedQuery({ [key]: operator })
          ) {
            // Handle JSONB nested queries for objects and arrays of objects
            const column = col(key);
            const jsonbSql = this.buildJsonbQuery(
              column,
              operator,
              schema,
              key,
            );
            if (jsonbSql) {
              conditions.push(jsonbSql);
            }
          } else {
            // Regular column query (including primitive arrays)
            const column = col(key);
            const sql = this.mapOperatorToSql(operator, column);
            if (sql) {
              conditions.push(sql);
            }
          }
        }
      }
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return and(...conditions);
  }

  /**
   * Build a JSONB query for nested object/array queries.
   */
  protected buildJsonbQuery(
    column: PgColumn,
    nestedQuery: any,
    schema: TObject,
    columnName: string,
  ): SQL | undefined {
    // Parse the nested query to extract paths and operators
    const queries = this.jsonQueryManager.parseNestedQuery(nestedQuery);

    if (queries.length === 0) {
      return undefined;
    }

    // Build conditions for each parsed query
    const conditions: SQL[] = [];

    for (const { path, operator } of queries) {
      // Check if this is an array property
      if (
        this.jsonQueryManager.isArrayProperty(schema, [columnName, ...path])
      ) {
        // Handle array queries
        const condition = this.jsonQueryManager.buildJsonbArrayCondition(
          column,
          path,
          "",
          operator,
        );
        if (condition) {
          conditions.push(condition);
        }
      } else {
        // Handle object queries
        const condition = this.jsonQueryManager.buildJsonbCondition(
          column,
          path,
          operator,
        );
        if (condition) {
          conditions.push(condition);
        }
      }
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    // Multiple conditions - AND them together
    return and(...conditions);
  }

  /**
   * Map a filter operator to a SQL query.
   */
  public mapOperatorToSql(
    operator: FilterOperators<any> | any,
    column: PgColumn,
  ): SQL | undefined {
    if (typeof operator !== "object") {
      return eq(column, operator);
    }

    const conditions: SQL[] = [];

    if (operator?.eq != null) {
      conditions.push(eq(column, operator.eq));
    }

    if (operator?.ne != null) {
      conditions.push(ne(column, operator.ne));
    }

    if (operator?.gt != null) {
      conditions.push(gt(column, operator.gt));
    }

    if (operator?.gte != null) {
      conditions.push(gte(column, operator.gte));
    }

    if (operator?.lt != null) {
      conditions.push(lt(column, operator.lt));
    }

    if (operator?.lte != null) {
      conditions.push(lte(column, operator.lte));
    }

    if (operator?.inArray != null) {
      conditions.push(inArray(column, operator.inArray));
    }

    if (operator?.notInArray != null) {
      conditions.push(notInArray(column, operator.notInArray));
    }

    if (operator?.isNull != null) {
      conditions.push(isNull(column));
    }

    if (operator?.isNotNull != null) {
      conditions.push(isNotNull(column));
    }

    if (operator?.like != null) {
      conditions.push(like(column, operator.like));
    }

    if (operator?.notLike != null) {
      conditions.push(notLike(column, operator.notLike));
    }

    if (operator?.ilike != null) {
      conditions.push(ilike(column, operator.ilike));
    }

    if (operator?.notIlike != null) {
      conditions.push(notIlike(column, operator.notIlike));
    }

    if (operator?.between != null) {
      conditions.push(
        between(column, operator.between[0], operator.between[1]),
      );
    }

    if (operator?.notBetween != null) {
      conditions.push(
        notBetween(column, operator.notBetween[0], operator.notBetween[1]),
      );
    }

    if (operator?.arrayContains != null) {
      conditions.push(arrayContains(column, operator.arrayContains));
    }

    if (operator?.arrayContained != null) {
      conditions.push(arrayContained(column, operator.arrayContained));
    }

    if (operator?.arrayOverlaps != null) {
      conditions.push(arrayOverlaps(column, operator.arrayOverlaps));
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return and(...conditions);
  }
}
