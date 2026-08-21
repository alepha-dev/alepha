import { $inject, Alepha, AlephaError, type ZObject, z } from "alepha";
import {
  and,
  arrayContained,
  arrayContains,
  arrayOverlaps,
  between,
  eq,
  exists,
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
  notExists,
  notIlike,
  notInArray,
  notLike,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type {
  PgQueryWhere,
  PgQueryWhereOrSQL,
} from "../interfaces/PgQueryWhere.ts";

export class QueryManager {
  protected readonly alepha = $inject(Alepha);

  /**
   * Convert a query object to a SQL query.
   */
  public toSQL(
    query: PgQueryWhereOrSQL<ZObject>,
    options: {
      schema: ZObject;
      col: (key: string) => PgColumn;
      joins?: PgJoin[];
      dialect: "postgresql" | "sqlite";
    },
  ): SQL | undefined {
    const { schema, col, joins } = options;
    const conditions: SQL[] = [];

    if (isSQLWrapper(query)) {
      conditions.push(query as SQL);
    } else {
      const keys = Object.keys(query) as Array<keyof PgQueryWhere<ZObject>>;

      for (const key of keys) {
        const operator = query[key] as SQL;

        // Drizzle silently drops `undefined` from WHERE, so a broken filter
        // (e.g. `organizationId: maybeUndefined`) becomes an unfiltered query
        // — the exact shape of a cross-tenant data leak. Fail loudly instead;
        // callers that want an optional filter must omit the key.
        if (operator === undefined) {
          throw new AlephaError(
            `Query filter '${key}' is explicitly undefined. ` +
              `An undefined condition would be silently dropped from the WHERE clause; ` +
              `omit the key instead if the filter is optional.`,
          );
        }

        // Handle joins - check if this key matches a join at the current level
        if (
          typeof query[key] === "object" &&
          query[key] != null &&
          !Array.isArray(query[key]) &&
          joins?.length
        ) {
          // Find the join that matches this key (at the current level, without parent filtering)
          const matchingJoins = joins.filter((j) => j.key === key);
          if (matchingJoins.length > 0) {
            // Use the first matching join (they should all have the same schema)
            const join = matchingJoins[0];

            // Build the full path to this join
            const joinPath = join.parent ? `${join.parent}.${key}` : key;

            // Find child joins: those whose parent starts with this join's path
            const childJoins = joins.filter((j) => {
              if (!j.parent) return false;
              // Child's parent should be exactly our path, or start with our path + "."
              return (
                j.parent === joinPath || j.parent.startsWith(`${joinPath}.`)
              );
            });

            // For recursion, we need to restructure child joins
            // Remove the current path prefix from parent keys
            const recursiveJoins = childJoins.map((j) => {
              const newParent =
                j.parent === joinPath
                  ? undefined
                  : j.parent!.substring(joinPath.length + 1);
              return {
                ...j,
                parent: newParent,
              };
            });

            const sql = this.toSQL(query[key], {
              schema: join.schema,
              col: join.col,
              joins: recursiveJoins.length > 0 ? recursiveJoins : undefined,
              dialect: options.dialect,
            });
            if (sql) {
              conditions.push(sql);
            }
            continue;
          }
        }

        // Only `and` / `or` carry a list of nested CONDITIONS. Any other key is
        // a column name, and an array under a column name is a VALUE — the
        // shorthand `PgQueryWhereOperators` documents for an array column
        // (`{ tags: ["x", "y"] }`). Recursing into it treated each element as a
        // condition object, so `Object.keys("x")` asked for a column literally
        // named `0` and the query died with "Column '0' not found".
        if (Array.isArray(operator) && (key === "and" || key === "or")) {
          const operations: SQL[] = operator
            .map((it) => {
              if (isSQLWrapper(it)) {
                return it as SQL;
              }
              return this.toSQL(it as PgQueryWhere<ZObject>, {
                schema,
                col,
                joins, // Pass joins through recursively
                dialect: options.dialect,
              });
            })
            .filter((it) => it != null);

          // Combine with the sibling conditions instead of returning early —
          // an early return here silently DROPPED every other key of the
          // where (e.g. `{ userId: {...}, or: [...] }` matched ALL users).
          const combined =
            key === "and" ? and(...operations) : or(...operations);
          if (combined) {
            conditions.push(combined);
          }
          continue;
        }

        if (key === "not") {
          const where = this.toSQL(operator as PgQueryWhereOrSQL<ZObject>, {
            schema,
            col,
            joins, // Pass joins through recursively
            dialect: options.dialect,
          });
          if (where) {
            conditions.push(not(where));
          }
          continue;
        }

        if (key === "exists") {
          conditions.push(exists(operator as SQLWrapper));
          continue;
        }

        if (key === "notExists") {
          conditions.push(notExists(operator as SQLWrapper));
          continue;
        }

        if (operator != null) {
          const column = col(key);
          const sql = this.mapOperatorToSql(
            operator,
            column,
            schema,
            key,
            options.dialect,
          );
          if (sql) {
            conditions.push(sql);
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
   * Check if an object has any filter operator properties.
   */
  protected hasFilterOperatorProperties(obj: any): boolean {
    if (!obj || typeof obj !== "object") return false;

    const filterOperatorKeys = [
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "inArray",
      "notInArray",
      "isNull",
      "isNotNull",
      "like",
      "notLike",
      "ilike",
      "notIlike",
      "eqInsensitive",
      "contains",
      "startsWith",
      "endsWith",
      "between",
      "notBetween",
      "arrayContains",
      "arrayContained",
      "arrayOverlaps",
    ];

    return filterOperatorKeys.some((key) => key in obj);
  }

  /**
   * Catch an operator object whose key is a near-miss for a real one.
   *
   * A value like `{ in: [1, 2] }` (the SQL spelling) instead of
   * `{ inArray: [1, 2] }` has no recognised operator key, so it fell through
   * to the direct-value branch and produced `eq(column, <object>)` — at best
   * a serialization error, at worst a query that silently matches nothing.
   *
   * Deliberately narrow: only names that are known aliases of real operators
   * are rejected. A plain object is a legitimate equality value for a JSON
   * column, and rejecting every unrecognised object would break that.
   */
  protected assertNotMistypedOperator(value: any, columnName?: string): void {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value instanceof Date ||
      isSQLWrapper(value)
    ) {
      return;
    }

    const aliases: Record<string, string> = {
      in: "inArray",
      notIn: "notInArray",
      nin: "notInArray",
      neq: "ne",
      not: "ne",
      equals: "eq",
      greaterThan: "gt",
      lessThan: "lt",
      isNotNULL: "isNotNull",
    };

    for (const key of Object.keys(value)) {
      const suggestion = aliases[key];
      if (suggestion) {
        throw new AlephaError(
          `Query filter${columnName ? ` '${columnName}'` : ""} uses unknown operator '${key}'. Did you mean '${suggestion}'? An unrecognised operator object is treated as a literal value, which matches nothing.`,
        );
      }
    }
  }

  /**
   * Map a filter operator to a SQL query.
   */
  public mapOperatorToSql(
    operator: any,
    column: PgColumn,
    columnSchema?: ZObject,
    columnName?: string,
    dialect: "postgresql" | "sqlite" = "postgresql",
  ): SQL | undefined {
    // Helper function to encode a value for the specific column
    const encodeValue = (value: any): any => {
      if (value == null) {
        return value;
      }

      // If we have schema information, encode the value properly
      if (columnSchema && columnName) {
        try {
          const fieldSchema = z.schema.shape(columnSchema)[columnName];
          if (fieldSchema) {
            // Encode the value using the drizzle codec
            // This converts application values (like Dayjs) to database values (like ISO strings)
            return this.alepha.codec.encode(fieldSchema, value, {
              encoder: "drizzle",
            });
          }
        } catch (error) {
          // If encoding fails, fall back to the original value
          // This ensures backward compatibility
        }
      }

      return value;
    };

    // Helper function to encode array values
    const encodeArray = (values: any[]): any[] => {
      return values.map((v) => encodeValue(v));
    };

    // If operator is not an object, OR it's an object but doesn't have any filter operator properties,
    // treat it as a direct value (e.g., string, number, Date, Dayjs, etc.)
    if (
      typeof operator !== "object" ||
      operator == null ||
      !this.hasFilterOperatorProperties(operator)
    ) {
      this.assertNotMistypedOperator(operator, columnName);
      return eq(column, encodeValue(operator));
    }

    const conditions: SQL[] = [];

    // `eq: undefined` would be silently dropped (no condition at all) — the
    // root cause of tenant-scoping leaks. Equality against "no value" is
    // always a caller bug; `isNull` exists for NULL matching.
    if ("eq" in operator && operator.eq === undefined) {
      throw new AlephaError(
        `Query filter${columnName ? ` '${columnName}'` : ""} has 'eq: undefined'. ` +
          `An undefined condition would be silently dropped from the WHERE clause; ` +
          `omit the operator instead if the filter is optional.`,
      );
    }

    if (operator?.eq != null) {
      conditions.push(eq(column, encodeValue(operator.eq)));
    }

    if (operator?.ne != null) {
      conditions.push(ne(column, encodeValue(operator.ne)));
    }

    if (operator?.gt != null) {
      conditions.push(gt(column, encodeValue(operator.gt)));
    }

    if (operator?.gte != null) {
      conditions.push(gte(column, encodeValue(operator.gte)));
    }

    if (operator?.lt != null) {
      conditions.push(lt(column, encodeValue(operator.lt)));
    }

    if (operator?.lte != null) {
      conditions.push(lte(column, encodeValue(operator.lte)));
    }

    if (operator?.inArray != null) {
      if (!Array.isArray(operator.inArray) || operator.inArray.length === 0) {
        throw new AlephaError("inArray operator requires at least one value");
      }
      conditions.push(inArray(column, encodeArray(operator.inArray)));
    }

    if (operator?.notInArray != null) {
      if (
        !Array.isArray(operator.notInArray) ||
        operator.notInArray.length === 0
      ) {
        throw new AlephaError(
          "notInArray operator requires at least one value",
        );
      }
      conditions.push(notInArray(column, encodeArray(operator.notInArray)));
    }

    // Presence is NOT the signal — the VALUE is. `!= null` made
    // `{ isNull: false }` emit `IS NULL`, the exact opposite predicate, because
    // `false != null` is true. Nothing in the where builder is allowed to mean
    // the reverse of what it reads as, so both flags now branch on the boolean.
    if (operator?.isNull != null) {
      conditions.push(operator.isNull ? isNull(column) : isNotNull(column));
    }

    if (operator?.isNotNull != null) {
      conditions.push(operator.isNotNull ? isNotNull(column) : isNull(column));
    }

    if (operator?.like != null) {
      conditions.push(like(column, encodeValue(operator.like)));
    }

    if (operator?.notLike != null) {
      conditions.push(notLike(column, encodeValue(operator.notLike)));
    }

    if (operator?.eqInsensitive != null) {
      // Equality, not a pattern: no LIKE metacharacters are involved, so a
      // raw user-supplied value cannot act as a wildcard.
      conditions.push(
        sql`LOWER(${column}) = LOWER(${encodeValue(operator.eqInsensitive)})`,
      );
    }

    if (operator?.ilike != null) {
      if (dialect === "sqlite") {
        // SQLite doesn't have ilike, use LOWER() for case-insensitive matching
        conditions.push(
          sql`LOWER(${column}) LIKE LOWER(${encodeValue(operator.ilike)})`,
        );
      } else {
        conditions.push(ilike(column, encodeValue(operator.ilike)));
      }
    }

    if (operator?.notIlike != null) {
      if (dialect === "sqlite") {
        // SQLite doesn't have ilike, use LOWER() for case-insensitive matching
        conditions.push(
          sql`LOWER(${column}) NOT LIKE LOWER(${encodeValue(operator.notIlike)})`,
        );
      } else {
        conditions.push(notIlike(column, encodeValue(operator.notIlike)));
      }
    }

    if (operator?.contains != null) {
      // Escape LIKE special characters to prevent wildcard injection
      const escapedValue = String(operator.contains)
        .replace(/\\/g, "\\\\") // Escape backslash first
        .replace(/%/g, "\\%") // Escape %
        .replace(/_/g, "\\_"); // Escape _

      if (dialect === "sqlite") {
        // SQLite doesn't have ilike, use LOWER() for case-insensitive matching
        // ESCAPE '\\' is required for SQLite to recognize backslash as escape character
        conditions.push(
          sql`LOWER(${column}) LIKE LOWER(${encodeValue(`%${escapedValue}%`)}) ESCAPE '\\'`,
        );
      } else {
        conditions.push(ilike(column, encodeValue(`%${escapedValue}%`)));
      }
    }

    if (operator?.startsWith != null) {
      // Escape LIKE special characters to prevent wildcard injection
      const escapedValue = String(operator.startsWith)
        .replace(/\\/g, "\\\\") // Escape backslash first
        .replace(/%/g, "\\%") // Escape %
        .replace(/_/g, "\\_"); // Escape _

      if (dialect === "sqlite") {
        // SQLite doesn't have ilike, use LOWER() for case-insensitive matching
        conditions.push(
          sql`LOWER(${column}) LIKE LOWER(${encodeValue(`${escapedValue}%`)}) ESCAPE '\\'`,
        );
      } else {
        conditions.push(ilike(column, encodeValue(`${escapedValue}%`)));
      }
    }

    if (operator?.endsWith != null) {
      // Escape LIKE special characters to prevent wildcard injection
      const escapedValue = String(operator.endsWith)
        .replace(/\\/g, "\\\\") // Escape backslash first
        .replace(/%/g, "\\%") // Escape %
        .replace(/_/g, "\\_"); // Escape _

      if (dialect === "sqlite") {
        // SQLite doesn't have ilike, use LOWER() for case-insensitive matching
        conditions.push(
          sql`LOWER(${column}) LIKE LOWER(${encodeValue(`%${escapedValue}`)}) ESCAPE '\\'`,
        );
      } else {
        conditions.push(ilike(column, encodeValue(`%${escapedValue}`)));
      }
    }

    if (operator?.between != null) {
      if (!Array.isArray(operator.between) || operator.between.length !== 2) {
        throw new AlephaError(
          "between operator requires exactly 2 values [min, max]",
        );
      }
      conditions.push(
        between(
          column,
          encodeValue(operator.between[0]),
          encodeValue(operator.between[1]),
        ),
      );
    }

    if (operator?.notBetween != null) {
      if (
        !Array.isArray(operator.notBetween) ||
        operator.notBetween.length !== 2
      ) {
        throw new AlephaError(
          "notBetween operator requires exactly 2 values [min, max]",
        );
      }
      conditions.push(
        notBetween(
          column,
          encodeValue(operator.notBetween[0]),
          encodeValue(operator.notBetween[1]),
        ),
      );
    }

    // The array operators map to postgres array functions (`@>`, `<@`, `&&`).
    // SQLite/D1 store a string array as JSON text, so emitting them there
    // produced invalid SQL or silently wrong semantics. The `ilike` family
    // above got a sqlite fallback; this one never did. Fail loudly rather
    // than run a query that means something else.
    const assertArrayOperatorSupported = (name: string) => {
      if (dialect === "sqlite") {
        throw new AlephaError(
          `Filter operator '${name}' is not supported on sqlite/D1: array columns are stored as JSON text there, so postgres array operators cannot apply. Filter in the handler, or model the values as a related table.`,
        );
      }
    };

    if (operator?.arrayContains != null) {
      assertArrayOperatorSupported("arrayContains");
      conditions.push(
        arrayContains(column, encodeValue(operator.arrayContains)),
      );
    }

    if (operator?.arrayContained != null) {
      assertArrayOperatorSupported("arrayContained");
      conditions.push(
        arrayContained(column, encodeValue(operator.arrayContained)),
      );
    }

    if (operator?.arrayOverlaps != null) {
      assertArrayOperatorSupported("arrayOverlaps");
      conditions.push(
        arrayOverlaps(column, encodeValue(operator.arrayOverlaps)),
      );
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return and(...conditions);
  }

  /**
   * Parse pagination sort string to orderBy format.
   * Format: "firstName,-lastName" -> [{ column: "firstName", direction: "asc" }, { column: "lastName", direction: "desc" }]
   * - Columns separated by comma
   * - Prefix with '-' for DESC direction
   *
   * @param sort Pagination sort string
   * @returns OrderBy array or single object
   */
  public parsePaginationSort(
    sort: string,
  ):
    | Array<{ column: string; direction: "asc" | "desc" }>
    | { column: string; direction: "asc" | "desc" } {
    const fields = sort.split(",").map((field) => field.trim());

    const orderByClauses = fields.map((field) => {
      if (field.startsWith("-")) {
        return {
          column: field.substring(1),
          direction: "desc" as const,
        };
      }
      return {
        column: field,
        direction: "asc" as const,
      };
    });

    // Return single object if only one field, array if multiple
    return orderByClauses.length === 1 ? orderByClauses[0] : orderByClauses;
  }

  /**
   * Normalize orderBy parameter to array format.
   * Supports 3 modes:
   * 1. String: "name" -> [{ column: "name", direction: "asc" }]
   * 2. Object: { column: "name", direction: "desc" } -> [{ column: "name", direction: "desc" }]
   * 3. Array: [{ column: "name" }, { column: "age", direction: "desc" }] -> normalized array
   *
   * @param orderBy The orderBy parameter
   * @returns Normalized array of order by clauses
   */
  public normalizeOrderBy(
    orderBy: any,
  ): Array<{ column: string; direction: "asc" | "desc" }> {
    // Mode 1: String -> single column, ASC by default
    if (typeof orderBy === "string") {
      return [{ column: orderBy, direction: "asc" }];
    }

    // Mode 2: Single object -> convert to array
    if (!Array.isArray(orderBy) && typeof orderBy === "object") {
      return [this.orderByClause(orderBy, orderBy)];
    }

    // Mode 3: Array -> normalize each item with default direction
    if (Array.isArray(orderBy)) {
      return orderBy.map((item) => this.orderByClause(item, orderBy));
    }

    return [];
  }

  /**
   * One clause, refusing a shape that has no column.
   *
   * `{ title: "asc" }` looks like an order-by and is not one — the shape is
   * `{ column, direction }`. Left alone it reaches the database as
   * `order by "undefined"`, and the driver's answer names a column nobody
   * wrote. TypeScript rejects it; this is for the callers TypeScript does not
   * reach.
   */
  protected orderByClause(
    item: any,
    orderBy: unknown,
  ): { column: string; direction: "asc" | "desc" } {
    if (typeof item?.column !== "string") {
      throw new AlephaError(
        `Invalid orderBy: expected { column, direction? }, got ${JSON.stringify(orderBy)}. ` +
          "A plain { column: direction } map is not the same shape.",
      );
    }

    return { column: item.column, direction: item.direction ?? "asc" };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PgJoin {
  table: string;
  schema: ZObject;
  key: string;
  col: (key: string) => PgColumn;
  parent?: string;
}
