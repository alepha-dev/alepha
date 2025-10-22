import type { TObject } from "@alepha/core";
import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { FilterOperators } from "../interfaces/FilterOperators.ts";
import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";

/**
 * Manages JSONB query generation for nested object and array queries in PostgreSQL.
 * This class handles complex nested queries using PostgreSQL's JSONB operators.
 */
export class PgJsonQueryManager {
  /**
   * Check if a query contains nested JSONB queries.
   * A nested query is when the value is an object with operator keys.
   */
  public hasNestedQuery(where: PgQueryWhere<TObject>): boolean {
    for (const [key, value] of Object.entries(where)) {
      // Skip logical operators
      if (key === "and" || key === "or" || key === "not") {
        continue;
      }

      // Check if value is an object with nested properties
      if (value && typeof value === "object" && !Array.isArray(value)) {
        // Check if it has operator keys or nested object keys
        const keys = Object.keys(value);
        const hasOperators = keys.some((k) =>
          [
            "eq",
            "ne",
            "gt",
            "gte",
            "lt",
            "lte",
            "like",
            "ilike",
            "isNull",
            "isNotNull",
            "inArray",
            "notInArray",
          ].includes(k),
        );

        // If it doesn't have operators, it might be a nested query
        if (!hasOperators && keys.length > 0) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Build a JSONB query condition for nested object queries.
   * Supports deep nesting like: { profile: { contact: { email: { eq: "test@example.com" } } } }
   *
   * @param column The JSONB column
   * @param path The path to the nested property (e.g., ['profile', 'contact', 'email'])
   * @param operator The filter operator (e.g., { eq: "test@example.com" })
   * @returns SQL condition
   */
  public buildJsonbCondition(
    column: PgColumn,
    path: string[],
    operator: FilterOperators<any>,
  ): SQL | undefined {
    if (path.length === 0) {
      return undefined;
    }

    // Build the JSONB path: column->'path1'->'path2'->>'lastPath'
    // Use ->> for the last element to get text, -> for intermediate elements
    let jsonPath = sql`${column}`;

    // Navigate through all path elements except the last
    for (let i = 0; i < path.length - 1; i++) {
      jsonPath = sql`${jsonPath}->${path[i]}`;
    }

    // For the last element, use ->> to extract as text
    const lastPath = path[path.length - 1];
    const jsonValue = sql`${jsonPath}->>${lastPath}`;

    // Apply the operator
    return this.applyOperatorToJsonValue(jsonValue, operator);
  }

  /**
   * Build JSONB array query conditions.
   * Supports queries like: { addresses: { city: { eq: "Wonderland" } } }
   * which translates to: EXISTS (SELECT 1 FROM jsonb_array_elements(addresses) elem WHERE elem->>'city' = 'Wonderland')
   */
  public buildJsonbArrayCondition(
    column: PgColumn,
    path: string[],
    arrayPath: string,
    operator: FilterOperators<any>,
  ): SQL | undefined {
    if (path.length === 0) {
      return undefined;
    }

    // Build the base JSONB path to the array
    let jsonPath = sql`${column}`;
    if (arrayPath) {
      jsonPath = sql`${jsonPath}->${arrayPath}`;
    }

    // Build the condition for array elements
    const lastPath = path[0];
    const elemCondition = sql`elem->>${lastPath}`;
    const condition = this.applyOperatorToJsonValue(elemCondition, operator);

    if (!condition) {
      return undefined;
    }

    // Wrap in EXISTS with jsonb_array_elements
    return sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS elem WHERE ${condition})`;
  }

  /**
   * Apply a filter operator to a JSONB value.
   */
  private applyOperatorToJsonValue(
    jsonValue: SQL,
    operator: FilterOperators<any>,
  ): SQL | undefined {
    if (typeof operator !== "object") {
      // Direct value comparison
      return sql`${jsonValue} = ${operator}`;
    }

    const conditions: SQL[] = [];

    if (operator.eq !== undefined) {
      conditions.push(sql`${jsonValue} = ${operator.eq}`);
    }

    if (operator.ne !== undefined) {
      conditions.push(sql`${jsonValue} != ${operator.ne}`);
    }

    if (operator.gt !== undefined) {
      // Cast to numeric for comparison
      conditions.push(sql`(${jsonValue})::numeric > ${operator.gt}`);
    }

    if (operator.gte !== undefined) {
      conditions.push(sql`(${jsonValue})::numeric >= ${operator.gte}`);
    }

    if (operator.lt !== undefined) {
      conditions.push(sql`(${jsonValue})::numeric < ${operator.lt}`);
    }

    if (operator.lte !== undefined) {
      conditions.push(sql`(${jsonValue})::numeric <= ${operator.lte}`);
    }

    if (operator.like !== undefined) {
      conditions.push(sql`${jsonValue} LIKE ${operator.like}`);
    }

    if (operator.ilike !== undefined) {
      conditions.push(sql`${jsonValue} ILIKE ${operator.ilike}`);
    }

    if (operator.notLike !== undefined) {
      conditions.push(sql`${jsonValue} NOT LIKE ${operator.notLike}`);
    }

    if (operator.notIlike !== undefined) {
      conditions.push(sql`${jsonValue} NOT ILIKE ${operator.notIlike}`);
    }

    if (operator.isNull !== undefined) {
      conditions.push(sql`${jsonValue} IS NULL`);
    }

    if (operator.isNotNull !== undefined) {
      conditions.push(sql`${jsonValue} IS NOT NULL`);
    }

    if (operator.inArray !== undefined && Array.isArray(operator.inArray)) {
      conditions.push(
        sql`${jsonValue} IN (${sql.join(
          operator.inArray.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }

    if (
      operator.notInArray !== undefined &&
      Array.isArray(operator.notInArray)
    ) {
      conditions.push(
        sql`${jsonValue} NOT IN (${sql.join(
          operator.notInArray.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    // Multiple conditions - AND them together
    return sql.join(conditions, sql` AND `);
  }

  /**
   * Parse a nested query object and extract the path and operator.
   * For example: { profile: { contact: { email: { eq: "test@example.com" } } } }
   * Returns: { path: ['profile', 'contact', 'email'], operator: { eq: "test@example.com" } }
   */
  public parseNestedQuery(
    nestedQuery: any,
    currentPath: string[] = [],
  ): Array<{ path: string[]; operator: FilterOperators<any> }> {
    const results: Array<{ path: string[]; operator: FilterOperators<any> }> =
      [];

    for (const [key, value] of Object.entries(nestedQuery)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        // Check if this is an operator object
        const keys = Object.keys(value);
        const hasOperators = keys.some((k) =>
          [
            "eq",
            "ne",
            "gt",
            "gte",
            "lt",
            "lte",
            "like",
            "ilike",
            "notLike",
            "notIlike",
            "isNull",
            "isNotNull",
            "inArray",
            "notInArray",
          ].includes(k),
        );

        if (hasOperators) {
          // This is an operator, add to results
          results.push({
            path: [...currentPath, key],
            operator: value as FilterOperators<any>,
          });
        } else {
          // This is a nested object, recurse
          const nestedResults = this.parseNestedQuery(value, [
            ...currentPath,
            key,
          ]);
          results.push(...nestedResults);
        }
      }
    }

    return results;
  }

  /**
   * Determine if a property is a JSONB column based on the schema.
   * A column is JSONB if it's defined as an object or array in the TypeBox schema.
   */
  public isJsonbColumn(schema: TObject, columnName: string): boolean {
    const property = schema.properties[columnName];
    if (!property) {
      return false;
    }

    // Check if it's an object or array type
    return (
      (property as any).type === "object" || (property as any).type === "array"
    );
  }

  /**
   * Check if an array property contains primitive types (string, number, boolean, etc.)
   * rather than objects. Primitive arrays should use native Drizzle operators.
   * @returns true if the array contains primitives, false if it contains objects
   */
  public isPrimitiveArray(schema: TObject, columnName: string): boolean {
    const property = schema.properties[columnName];
    if (!property || (property as any).type !== "array") {
      return false;
    }

    // Check the items type
    const items = (property as any).items;
    if (!items) {
      return false;
    }

    // If items is an object type, it's not a primitive array
    // Primitive types are: string, number, integer, boolean, null
    const itemType = items.type;
    return (
      itemType === "string" ||
      itemType === "number" ||
      itemType === "integer" ||
      itemType === "boolean" ||
      itemType === "null"
    );
  }

  /**
   * Check if a nested path points to an array property.
   */
  public isArrayProperty(schema: TObject, path: string[]): boolean {
    if (path.length === 0) {
      return false;
    }

    let currentSchema: any = schema.properties[path[0]];
    if (!currentSchema) {
      return false;
    }

    // If first element is an array, return true
    if (currentSchema.type === "array") {
      return true;
    }

    // Navigate through nested objects
    for (let i = 1; i < path.length; i++) {
      if (currentSchema.type === "object" && currentSchema.properties) {
        currentSchema = currentSchema.properties[path[i]];
        if (!currentSchema) {
          return false;
        }
        if (currentSchema.type === "array") {
          return true;
        }
      } else {
        return false;
      }
    }

    return false;
  }
}
