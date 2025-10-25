import type { Static, TObject } from "@alepha/core";
import { KIND } from "@alepha/core";
import type { BuildColumns, BuildExtraConfigColumns, SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  alias,
  index,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  pgTable,
  type TableConfig,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  type FromSchema,
  schemaToPgColumns,
} from "../helpers/schemaToPgColumns.ts";
import { insertSchema, type TObjectInsert } from "../schemas/insertSchema.ts";
import { type TObjectUpdate, updateSchema } from "../schemas/updateSchema.ts";

/**
 * Creates a database entity descriptor that defines table structure using TypeBox schemas.
 *
 * This descriptor provides a type-safe way to define database tables using JSON Schema
 * syntax while generating the necessary database metadata for migrations and operations.
 * It integrates with Drizzle ORM under the hood and works seamlessly with the $repository
 * descriptor for complete database functionality.
 *
 * **Key Features**
 *
 * - **Type-Safe Schema Definition**: Uses TypeBox for full TypeScript type inference
 * - **Automatic Table Generation**: Creates Drizzle ORM table structures automatically
 * - **Index Management**: Supports single-column, multi-column, and unique indexes
 * - **Constraint Support**: Foreign keys, unique constraints, and check constraints
 * - **Audit Fields**: Built-in support for created_at, updated_at, deleted_at, and version fields
 * - **Schema Validation**: Automatic insert/update schema generation with validation
 *
 * **Important Note**:
 * This descriptor only defines the table structure - it does not create the physical
 * database table. Use it with $repository to perform actual database operations,
 * and run migrations to create the tables in your database.
 *
 * **Use Cases**
 *
 * Essential for defining database schema in type-safe applications:
 * - User management and authentication tables
 * - Business domain entities (products, orders, customers)
 * - Audit and logging tables
 * - Junction tables for many-to-many relationships
 * - Configuration and settings tables
 *
 * @example
 * **Basic entity with indexes:**
 * ```ts
 * import { $entity } from "alepha/postgres";
 * import { pg, t } from "alepha";
 *
 * const User = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     email: t.text({ format: "email" }),
 *     username: t.text({ minLength: 3, maxLength: 30 }),
 *     firstName: t.text(),
 *     lastName: t.text(),
 *     isActive: t.boolean({ default: true }),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt(),
 *     deletedAt: pg.deletedAt()
 *   }),
 *   indexes: [
 *     "email",              // Simple index on email
 *     "username",           // Simple index on username
 *     { column: "email", unique: true },  // Unique constraint on email
 *     { columns: ["firstName", "lastName"] } // Composite index
 *   ]
 * });
 * ```
 *
 * @example
 * **E-commerce product entity with relationships:**
 * ```ts
 * const Product = $entity({
 *   name: "products",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     sku: t.text({ minLength: 3 }),
 *     name: t.text({ minLength: 1, maxLength: 200 }),
 *     description: t.optional(t.text()),
 *     price: t.number({ minimum: 0 }),
 *     categoryId: t.text({ format: "uuid" }),
 *     inStock: t.boolean({ default: true }),
 *     stockQuantity: t.integer({ minimum: 0, default: 0 }),
 *     tags: t.optional(t.array(t.text())), // PostgreSQL array column
 *     metadata: t.optional(t.record(t.text(), t.any())), // JSONB column
 *     version: pg.version(),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt()
 *   }),
 *   indexes: [
 *     { column: "sku", unique: true },        // Unique SKU
 *     "categoryId",                           // Foreign key index
 *     "inStock",                             // Filter frequently by stock status
 *     { columns: ["categoryId", "inStock"] }, // Composite for category + stock queries
 *     "createdAt"                            // For date-based queries
 *   ],
 *   foreignKeys: [
 *     {
 *       name: "fk_product_category",
 *       columns: ["categoryId"],
 *       foreignColumns: [Category.id] // Reference to Category entity
 *     }
 *   ]
 * });
 * ```
 *
 * @example
 * **Audit log entity with constraints:**
 * ```ts
 * const AuditLog = $entity({
 *   name: "audit_logs",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     tableName: t.text(),
 *     recordId: t.text(),
 *     action: t.enum(["CREATE", "UPDATE", "DELETE"]),
 *     userId: t.optional(t.text({ format: "uuid" })),
 *     oldValues: t.optional(t.record(t.text(), t.any())),
 *     newValues: t.optional(t.record(t.text(), t.any())),
 *     timestamp: pg.createdAt(),
 *     ipAddress: t.optional(t.text()),
 *     userAgent: t.optional(t.text())
 *   }),
 *   indexes: [
 *     "tableName",
 *     "recordId",
 *     "userId",
 *     "action",
 *     { columns: ["tableName", "recordId"] }, // Find all changes to a record
 *     { columns: ["userId", "timestamp"] },   // User activity timeline
 *     "timestamp"  // Time-based queries
 *   ],
 *   constraints: [
 *     {
 *       name: "valid_action_values",
 *       columns: ["action"],
 *       check: sql`action IN ('CREATE', 'UPDATE', 'DELETE')`
 *     }
 *   ]
 * });
 * ```
 *
 * @example
 * **Many-to-many junction table:**
 * ```ts
 * const UserRole = $entity({
 *   name: "user_roles",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     userId: t.text({ format: "uuid" }),
 *     roleId: t.text({ format: "uuid" }),
 *     assignedBy: t.text({ format: "uuid" }),
 *     assignedAt: pg.createdAt(),
 *     expiresAt: t.optional(t.datetime())
 *   }),
 *   indexes: [
 *     "userId",
 *     "roleId",
 *     "assignedBy",
 *     { columns: ["userId", "roleId"], unique: true }, // Prevent duplicate assignments
 *     "expiresAt" // For cleanup of expired roles
 *   ],
 *   foreignKeys: [
 *     {
 *       columns: ["userId"],
 *       foreignColumns: [User.id]
 *     },
 *     {
 *       columns: ["roleId"],
 *       foreignColumns: [Role.id]
 *     },
 *     {
 *       columns: ["assignedBy"],
 *       foreignColumns: [User.id]
 *     }
 *   ]
 * });
 * ```
 */
export const $entity = <
  TTableName extends string,
  TSchema extends TObject,
  TColumnsMap extends FromSchema<TSchema>,
>(
  options: EntityDescriptorOptions<TTableName, TSchema>,
): PgTableWithColumnsAndSchema<
  PgTableConfig<TTableName, TSchema, TColumnsMap>,
  TSchema
> => {
  return pgTableSchema<TTableName, TSchema, TColumnsMap>(
    options.name,
    options.schema,
    (t) => {
      const config: PgTableExtraConfigValue[] = [];

      if (options.config) {
        config.push(...options.config(t));
      }

      if (options.indexes) {
        for (const idx of options.indexes) {
          if (typeof idx === "string") {
            const name = `${options.name}_${idx}_idx`;
            config.push(index(name).on(t[idx]));
          } else if (typeof idx === "object") {
            if ("columns" in idx) {
              const columnsName = idx.columns.join("_");
              const columns = idx.columns.map((col) => t[col]);
              const name = idx.name ?? `${options.name}_${columnsName}_idx`;
              config.push(
                (idx.unique ? uniqueIndex(name) : index(name)).on(
                  columns[0],
                  ...columns.slice(1), // nice one, drizzle
                ),
              );
            } else {
              const name =
                idx.name ?? `${options.name}_${String(idx.column)}_idx`;
              config.push(
                (idx.unique ? uniqueIndex(name) : index(name)).on(
                  t[idx.column],
                ),
              );
            }
          }
        }
      }

      return config;
    },
  );
};

$entity[KIND] = "entity";

// ---------------------------------------------------------------------------------------------------------------------

export interface EntityDescriptorOptions<
  TTableName extends string,
  T extends TObject,
  Keys = keyof Static<T>,
> {
  /**
   * The database table name that will be created for this entity.
   */
  name: TTableName;

  /**
   * TypeBox schema defining the table structure and column types.
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
     */
    foreignColumns: Array<AnyPgColumn>;
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
   * **Use Cases**:
   * - Enforce unique combinations of columns
   * - Validate value ranges or patterns
   * - Ensure consistent data states
   * - Implement business rule validation
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
   *
   * This allows you to use advanced Drizzle ORM features that aren't covered
   * by the simplified options above. Use this for:
   * - Custom index types (GIN, GIST, etc.)
   * - Partial indexes with WHERE clauses
   * - Advanced constraint configurations
   * - PostgreSQL-specific features
   *
   * **When to Use**:
   * - Need PostgreSQL-specific index types
   * - Require partial indexes for performance
   * - Want fine-grained control over table creation
   * - Using advanced PostgreSQL features
   *
   * See Drizzle ORM documentation for complete configuration options.
   *
   * @param self - The table columns available for configuration
   * @returns Array of Drizzle table configuration objects
   *
   * @example
   * ```ts
   * config: (table) => [
   *   // Partial index for active users only
   *   index("idx_active_users_email")
   *     .on(table.email)
   *     .where(sql`is_active = true`),
   *
   *   // GIN index for full-text search
   *   index("idx_content_search")
   *     .using("gin", table.searchVector),
   *
   *   // Unique constraint with custom options
   *   uniqueIndex("idx_unique_slug_per_tenant")
   *     .on(table.tenantId, table.slug)
   * ]
   * ```
   */
  config?: (
    self: BuildExtraConfigColumns<string, FromSchema<T>, "pg">,
  ) => PgTableExtraConfigValue[];
}

export type Entity<T extends TObject> = PgTableWithColumnsAndSchema<
  PgTableConfig<string, T, FromSchema<T>>,
  T
>;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create a table with a json schema.
 *
 * @param name The name of the table.
 * @param schema The json schema of the table.
 * @param extraConfig Extra configuration for the table.
 */
const pgTableSchema = <
  TTableName extends string,
  TSchema extends TObject,
  TColumnsMap extends FromSchema<TSchema>,
>(
  name: TTableName,
  schema: TSchema,
  extraConfig?: (
    self: BuildExtraConfigColumns<TTableName, TColumnsMap, "pg">,
  ) => PgTableExtraConfigValue[],
): PgTableWithColumnsAndSchema<
  PgTableConfig<TTableName, TSchema, TColumnsMap>,
  TSchema
> => {
  // add enum or other custom type tracking if needed
  const registry = new Map<string, any>();

  const table = pgTable(
    name,
    schemaToPgColumns(name, schema, registry) as TColumnsMap,
    extraConfig,
  ) as PgTableWithColumnsAndSchema<
    PgTableConfig<TTableName, TSchema, TColumnsMap>,
    TSchema
  >;

  Object.defineProperty(table, "$table", {
    get: () => table,
  });
  Object.defineProperty(table, "$schema", {
    get: () => schema,
  });
  Object.defineProperty(table, "$insertSchema", {
    get: () => insertSchema(schema),
  });
  Object.defineProperty(table, "$updateSchema", {
    get: () => updateSchema(schema),
  });
  Object.defineProperty(table, "alias", {
    get: () => (name: string) => {
      return alias(table, name);
    },
  });
  Object.defineProperty(table, "registry", {
    get: () => registry,
  });

  return table;
};

export type PgTableConfig<
  TTableName extends string,
  TSchema extends TObject,
  TColumnsMap extends FromSchema<TSchema>,
> = {
  name: TTableName;
  schema: any;
  columns: BuildColumns<TTableName, TColumnsMap, "pg">;
  dialect: "pg";
};

/**
 * A table with columns and schema.
 */
export type PgTableWithColumnsAndSchema<
  T extends TableConfig,
  R extends TObject,
> = PgTableWithColumns<T> & {
  get $table(): PgTableWithColumns<T>;
  get $schema(): R;
  get $insertSchema(): TObjectInsert<R>;
  get $updateSchema(): TObjectUpdate<R>;
  alias: (alias: string) => PgTableWithColumnsAndSchema<T, R>;
  get registry(): Map<string, any>;
};
