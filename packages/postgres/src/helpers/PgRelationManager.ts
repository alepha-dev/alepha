import type { TObject } from "@alepha/core";
import { getTableName, type SQL, sql } from "drizzle-orm";
import {
  alias,
  type PgSelectBase,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import { isSQLWrapper } from "drizzle-orm/sql/sql";
import type { PgRelationMap } from "../interfaces/PgQuery.ts";
import type { PgJoin } from "./PgQueryManager.ts";
import type { PgTableWithColumnsAndSchema } from "./schemaToPgColumns.ts";

export class PgRelationManager {
  public buildJoins(
    builder: PgSelectBase<any, any, any>,
    joins: Array<PgJoin>,
    withRelations: PgRelationMap<TObject>,
    table: PgTableWithColumnsAndSchema<any, any>,
    parentKey?: string,
  ) {
    for (const [key, join] of Object.entries(withRelations)) {
      let from = join.join as PgTableWithColumns<any>;
      if (from === table) {
        from = alias(from, key);
      }

      const on = isSQLWrapper(join.on)
        ? (join.on as SQL)
        : sql`${table[join.on[0] as string]} = ${join.on[1]}`;

      if (join.type === "right") {
        builder.rightJoin(from, on);
      } else if (join.type === "inner") {
        builder.innerJoin(from, on);
      } else {
        builder.leftJoin(from, on);
      }

      joins.push({
        key,
        table: getTableName(join.join),
        schema: join.join.$schema,
        col: (name: string) => {
          return (join.join as any)[name];
        },
        parent: parentKey,
      });

      if (join.with) {
        this.buildJoins(
          builder,
          joins,
          join.with,
          join.join as PgTableWithColumnsAndSchema<any, any>,
          parentKey ? `${parentKey}.${key}` : key,
        );
      }
    }
  }

  public mapRowWithJoins(
    record: Record<string, unknown>,
    row: Record<string, unknown>,
    schema: TObject,
    joins: PgJoin[],
    parentKey?: string,
  ) {
    for (const join of joins) {
      if (join.parent === parentKey) {
        const joinedData = row[join.table];
        // Set to undefined if all values in the joined table are null (left join with no match)
        if (this.isAllNull(joinedData)) {
          record[join.key] = undefined;
        } else {
          record[join.key] = joinedData;
          // Only process nested joins if the parent join has data
          this.mapRowWithJoins(
            record[join.key] as Record<string, unknown>,
            row,
            schema, // Don't need to pass modified schema, just for recursion
            joins,
            parentKey ? `${parentKey}.${join.key}` : join.key,
          );
        }
      }
    }
    return record;
  }

  /**
   * Check if all values in an object are null (indicates a left join with no match)
   */
  private isAllNull(obj: unknown): boolean {
    if (obj === null || obj === undefined) return true;
    if (typeof obj !== "object") return false;
    return Object.values(obj).every((val) => val === null);
  }
}
