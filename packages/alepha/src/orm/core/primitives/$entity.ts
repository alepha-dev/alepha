import { type Infer, KIND, type ZObject, z } from "alepha";
import type { BuildExtraConfigColumns, SQL } from "drizzle-orm";
import type {
  PgColumn,
  PgColumnBuilder,
  PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { insertSchema, type TObjectInsert } from "../schemas/insertSchema.ts";
import { type TObjectUpdate, updateSchema } from "../schemas/updateSchema.ts";

/**
 * Creates a database entity primitive that defines table structure using Zod schemas.
 *
 * @example
 * ```ts
 * import { z } from "alepha";
 * import { $entity, db } from "alepha/orm";
 *
 * const userEntity = $entity({
 *   name: "users",
 *   schema: z.object({
 *     id: db.primaryKey(),
 *     name: z.text(),
 *     email: z.email(),
 *   }),
 * });
 * ```
 */
export const $entity = <ZType extends ZObject>(
  options: EntityPrimitiveOptions<ZType>,
): EntityPrimitive<ZType> => {
  return new EntityPrimitive<ZType>(options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface EntityPrimitiveOptions<
  T extends ZObject,
  Keys = keyof Infer<T>,
> {
  /**
   * The database table name that will be created for this entity.
   * If not provided, name will be inferred from the $repository variable name.
   */
  name: string;

  /**
   * Zod schema defining the table structure and column types.
   */
  schema: T;

  /**
   * Database indexes to create for query optimization.
   */
  indexes?: (
    | Keys
    | {
        /**
         * Single column to index.
         */
        column: Keys;
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name?: string;
        /**
         * Partial index condition. Only rows matching this SQL expression are indexed.
         */
        where?: SQL;
      }
    | {
        /**
         * Multiple columns for composite index (order matters for query optimization).
         */
        columns: Keys[];
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name?: string;
        /**
         * Partial index condition. Only rows matching this SQL expression are indexed.
         */
        where?: SQL;
      }
    | {
        /**
         * SQL expressions for expression-based indexes.
         *
         * Can include column references and SQL functions like `LOWER()`, `UPPER()`, etc.
         * Columns and expressions can be mixed together.
         *
         * @example
         * ```ts
         * // Case-insensitive unique username per realm
         * indexes: [{
         *   expressions: (self) => [self.realm, sql`LOWER(${self.username})`],
         *   unique: true,
         *   name: "users_realm_username_lower_idx",
         * }]
         * ```
         */
        expressions: (self: Record<Keys & string, any>) => any[];
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name: string;
        /**
         * Partial index condition. Only rows matching this SQL expression are indexed.
         */
        where?: SQL;
      }
  )[];

  /**
   * Foreign key constraints to maintain referential integrity.
   */
  foreignKeys?: Array<{
    /**
     * Optional name for the foreign key constraint.
     */
    name?: string;
    /**
     * Local columns that reference the foreign table.
     */
    columns: Array<keyof Infer<T>>;
    /**
     * Referenced columns in the foreign table.
     * Must be EntityColumn references from other entities.
     */
    foreignColumns: Array<() => EntityColumn<any>>;
  }>;

  /**
   * Additional table constraints for data validation.
   *
   * Constraints enforce business rules at the database level, providing
   * an additional layer of data integrity beyond application validation.
   *
   * **Constraint Types**:
   * - **Unique constraints**: Prevent duplicate values across columns
   * - **Check constraints**: Enforce custom validation rules with SQL expressions
   *
   * @example
   * ```ts
   * constraints: [
   *   {
   *     name: "unique_user_email",
   *     columns: ["email"],
   *     unique: true
   *   },
   *   {
   *     name: "valid_age_range",
   *     columns: ["age"],
   *     check: sql`age >= 0 AND age <= 150`
   *   },
   *   {
   *     name: "unique_user_username_per_tenant",
   *     columns: ["tenantId", "username"],
   *     unique: true
   *   }
   * ]
   * ```
   */
  constraints?: Array<{
    /**
     * Columns involved in this constraint.
     */
    columns: Array<keyof Infer<T>>;
    /**
     * Optional name for the constraint.
     */
    name?: string;
    /**
     * Whether this is a unique constraint.
     */
    unique?: boolean | {} /* options */;
    /**
     * SQL expression for check constraint validation.
     */
    check?: SQL;
  }>;

  /**
   * Advanced Drizzle ORM configuration for complex table setups.
   */
  config?: (
    self: BuildExtraConfigColumns<string, FromSchema<T>, "pg">,
  ) => PgTableExtraConfigValue[];
}

// ---------------------------------------------------------------------------------------------------------------------

export class EntityPrimitive<T extends ZObject = ZObject> {
  public readonly options: EntityPrimitiveOptions<T>;

  constructor(options: EntityPrimitiveOptions<T>) {
    this.options = options;
  }

  alias(alias: string): this {
    const aliased = new EntityPrimitive<T>(this.options);
    return new Proxy(aliased, {
      get(target, prop, receiver) {
        if (prop === "$alias") {
          return alias;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as this;
  }

  get cols(): EntityColumns<T> {
    const cols: Partial<EntityColumns<T>> = {};
    for (const key of Object.keys(z.schema.shape(this.schema)) as Array<
      keyof T["shape"]
    >) {
      cols[key] = {
        name: key as string,
        entity: this,
      };
    }

    return cols as EntityColumns<T>;
  }

  get name(): string {
    return this.options.name;
  }

  get schema(): T {
    return this.options.schema;
  }

  protected _insertSchema?: TObjectInsert<T>;
  get insertSchema(): TObjectInsert<T> {
    this._insertSchema ??= insertSchema(this.options.schema);
    return this._insertSchema;
  }

  protected _updateSchema?: TObjectUpdate<T>;
  get updateSchema(): TObjectUpdate<T> {
    this._updateSchema ??= updateSchema(this.options.schema);
    return this._updateSchema;
  }
}

$entity[KIND] = EntityPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Convert a schema to columns.
 */
export type FromSchema<T extends ZObject> = {
  [key in keyof T["shape"]]: PgColumnBuilder;
};

/**
 * Map a column's TypeScript value onto Drizzle's `dataType` tag.
 *
 * Drizzle's `ColumnDataType` union has no `date` or `json` member — both are
 * `object` there — so anything that is not a primitive lands on `object`.
 */
export type SchemaToDataType<T> = T extends string
  ? "string"
  : T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : T extends bigint
        ? "bigint"
        : T extends Array<any>
          ? "array"
          : "object";

/**
 * A Drizzle column that still carries its value type.
 *
 * `PgColumn`'s **first** type parameter is the data type and the config is the
 * **second**, so a bare `PgColumn` silently defaults both away. That single
 * detail cost this codebase two separate bugs: query results came back
 * `unknown` through anything that reads the table type, and `columns:`
 * projection never narrowed a result — the compiler kept promising fields that
 * had already been stripped at runtime.
 */
export type SchemaToColumn<
  TName extends string,
  TTable extends string,
  TData,
> = PgColumn<
  SchemaToDataType<NonNullable<TData>>,
  {
    name: TName;
    tableName: TTable;
    dataType: SchemaToDataType<NonNullable<TData>>;
    columnType: string;
    data: NonNullable<TData>;
    driverParam: unknown;
    notNull: undefined extends TData ? false : true;
    /**
     * Always `true`, which is a deliberate looseness on the *insert* side.
     *
     * This config is derived from the select schema, which cannot say which
     * columns have a database default — a generated primary key looks exactly
     * like a required one. Claiming `false` would make drizzle demand every
     * column on a raw `db.insert(table).values(...)`, including the ones the
     * database fills in.
     *
     * Nothing is lost by it: what actually validates an insert is the entity's
     * own `insertSchema`, applied in `Repository.cast()`. This only affects
     * raw drizzle inserts, which were equally permissive before the columns
     * carried their types at all.
     */
    hasDefault: true;
    isPrimaryKey: false;
    isAutoincrement: false;
    hasRuntimeDefault: false;
    enumValues: undefined;
    generated: undefined;
    identity: undefined;
  }
>;

export type SchemaToTableConfig<T extends ZObject> = {
  name: string;
  schema: string | undefined;
  columns: {
    [key in keyof Infer<T> & string]: SchemaToColumn<
      key,
      string,
      Infer<T>[key]
    >;
  };
  dialect: string;
};

export type EntityColumn<T extends ZObject> = {
  name: string;
  entity: EntityPrimitive<T>;
};

export type EntityColumns<T extends ZObject> = {
  [key in keyof T["shape"]]: EntityColumn<T>;
};
