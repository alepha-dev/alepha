import { $inject, SchemaValidator, type TObject } from "alepha";
import { getTableName, type SQL, sql } from "drizzle-orm";
import type { PgSelectBase, PgTableWithColumns } from "drizzle-orm/pg-core";
import { isSQLWrapper } from "drizzle-orm/sql/sql";
import type { PgRelationMap } from "../interfaces/PgQuery.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import type { PgJoin } from "./QueryManager.ts";

export class PgRelationManager {
  protected readonly schemaValidator = $inject(SchemaValidator);

  /**
   * Recursively build joins for the query builder based on the relations map
   */
  public buildJoins(
    provider: DatabaseProvider,
    // rc.4 added a required 4th type param (TSelectMode) to PgSelectBase.
    // This file is slated for removal in favor of Drizzle v1's
    // `defineRelations` (see follow-up spec) — minimal arity fix only.
    builder: PgSelectBase<any, any, any, any>,
    joins: Array<PgJoin>,
    withRelations: PgRelationMap<TObject>,
    table: PgTableWithColumns<any>,
    parentKey?: string,
  ) {
    for (const [key, join] of Object.entries(withRelations)) {
      const from = provider.table(join.join as EntityPrimitive);
      const on = isSQLWrapper(join.on)
        ? (join.on as SQL)
        : sql`${table[join.on[0] as string]} = ${from[join.on[1].name]}`;

      if (join.type === "right") {
        builder.rightJoin(from, on);
      } else if (join.type === "inner") {
        builder.innerJoin(from, on);
      } else {
        builder.leftJoin(from, on);
      }

      joins.push({
        key,
        table: getTableName(from),
        schema: join.join.schema,
        col: (name: string) => from[name],
        parent: parentKey,
      });

      if (join.with) {
        this.buildJoins(
          provider,
          builder,
          joins,
          join.with,
          from,
          parentKey ? `${parentKey}.${key}` : key,
        );
      }
    }
  }

  /**
   * Map a row with its joined relations based on the joins definition
   */
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
  protected isAllNull(obj: unknown): boolean {
    if (obj === null || obj === undefined) return true;
    if (typeof obj !== "object") return false;
    return Object.values(obj).every((val) => val === null);
  }

  /**
   * Build a schema that includes all join properties recursively
   */
  public buildSchemaWithJoins(
    baseSchema: TObject,
    joins: PgJoin[],
    parentPath?: string,
  ): TObject {
    const schema = this.schemaValidator.clone(baseSchema) as TObject;

    // Group joins by parent
    const joinsAtThisLevel = joins.filter((j) => j.parent === parentPath);

    for (const join of joinsAtThisLevel) {
      // Build the path for this join
      const joinPath = parentPath ? `${parentPath}.${join.key}` : join.key;

      // Find child joins
      const childJoins = joins.filter((j) => j.parent === joinPath);

      // If there are child joins, recursively build the schema
      let joinSchema = join.schema;
      if (childJoins.length > 0) {
        joinSchema = this.buildSchemaWithJoins(join.schema, joins, joinPath);
      }

      // Make the join optional (left joins may return null)
      schema.properties[join.key] = joinSchema.optional();
    }

    return schema;
  }
}
