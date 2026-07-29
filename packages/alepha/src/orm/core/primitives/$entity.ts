import { KIND, type Static, type TObject } from "alepha";
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
export const $entity = <TSchema extends TObject>(
  options: EntityPrimitiveOptions<TSchema>,
): EntityPrimitive<TSchema> => {
  return new EntityPrimitive<TSchema>(options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface EntityPrimitiveOptions<
  T extends TObject,
  Keys = keyof Static<T>,
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
        expressions: (self: Record<Keys & string, any>) => (SQL | any)[];
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
    columns: Array<keyof Static<T>>;
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
    columns: Array<keyof Static<T>>;
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

export class EntityPrimitive<T extends TObject = TObject> {
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
    for (const key of Object.keys(this.schema.properties) as Array<
      keyof T["properties"]
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
export type FromSchema<T extends TObject> = {
  [key in keyof T["properties"]]: PgColumnBuilder;
};

export type SchemaToTableConfig<T extends TObject> = {
  name: string;
  schema: string | undefined;
  columns: {
    [key in keyof T["properties"]]: PgColumn;
  };
  dialect: string;
};

export type EntityColumn<T extends TObject> = {
  name: string;
  entity: EntityPrimitive<T>;
};

export type EntityColumns<T extends TObject> = {
  [key in keyof T["properties"]]: EntityColumn<T>;
};
