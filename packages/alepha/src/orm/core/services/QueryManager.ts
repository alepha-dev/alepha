import {
  $inject,
  Alepha,
  AlephaError,
  createPagination,
  type TObject,
} from "alepha";
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
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { FilterOperators } from "../interfaces/FilterOperators.ts";
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
    query: PgQueryWhereOrSQL<TObject>,
    options: {
      schema: TObject;
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
      const keys = Object.keys(query) as Array<
        keyof PgQueryWhere<TObject> & string
      >;

      for (const key of keys) {
        const operator = query[key] as SQL;

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

        if (Array.isArray(operator)) {
          const operations: SQL[] = operator
            .map((it) => {
              if (isSQLWrapper(it)) {
                return it as SQL;
              }
              return this.toSQL(it as PgQueryWhere<TObject>, {
                schema,
                col,
                joins, // Pass joins through recursively
                dialect: options.dialect,
              });
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
          const where = this.toSQL(operator as PgQueryWhereOrSQL<TObject>, {
            schema,
            col,
            joins, // Pass joins through recursively
            dialect: options.dialect,
          });
          if (where) {
            return not(where);
          }
        }

        if (operator) {
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
   * Map a filter operator to a SQL query.
   */
  public mapOperatorToSql(
    operator: FilterOperators<any> | any,
    column: PgColumn,
    columnSchema?: TObject,
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
          const fieldSchema = columnSchema.properties[columnName];
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
      return eq(column, encodeValue(operator));
    }

    const conditions: SQL[] = [];

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

    if (operator?.isNull != null) {
      conditions.push(isNull(column));
    }

    if (operator?.isNotNull != null) {
      conditions.push(isNotNull(column));
    }

    if (operator?.like != null) {
      conditions.push(like(column, encodeValue(operator.like)));
    }

    if (operator?.notLike != null) {
      conditions.push(notLike(column, encodeValue(operator.notLike)));
    }

    if (operator?.ilike != null) {
      conditions.push(ilike(column, encodeValue(operator.ilike)));
    }

    if (operator?.notIlike != null) {
      conditions.push(notIlike(column, encodeValue(operator.notIlike)));
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
        throw new Error(
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
        throw new Error(
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

    if (operator?.arrayContains != null) {
      conditions.push(
        arrayContains(column, encodeValue(operator.arrayContains)),
      );
    }

    if (operator?.arrayContained != null) {
      conditions.push(
        arrayContained(column, encodeValue(operator.arrayContained)),
      );
    }

    if (operator?.arrayOverlaps != null) {
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
      return [
        {
          column: orderBy.column,
          direction: orderBy.direction ?? "asc",
        },
      ];
    }

    // Mode 3: Array -> normalize each item with default direction
    if (Array.isArray(orderBy)) {
      return orderBy.map((item) => ({
        column: item.column,
        direction: item.direction ?? "asc",
      }));
    }

    return [];
  }

  /**
   * Create a pagination object.
   *
   * @deprecated Use `createPagination` from alepha instead.
   * This method now delegates to the framework-level helper.
   *
   * @param entities The entities to paginate.
   * @param limit The limit of the pagination.
   * @param offset The offset of the pagination.
   * @param sort Optional sort metadata to include in response.
   */
  public createPagination<T>(
    entities: T[],
    limit = 10,
    offset = 0,
    sort?: Array<{ column: string; direction: "asc" | "desc" }>,
  ) {
    return createPagination(entities, limit, offset, sort);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PgJoin {
  table: string;
  schema: TObject;
  key: string;
  col: (key: string) => PgColumn;
  parent?: string;
}
