import type { Static, TObject } from "@alepha/core";
import { KIND } from "@alepha/core";
import type { BuildColumns, BuildExtraConfigColumns, SQL } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	type PgTableExtraConfigValue,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import {
	type FromSchema,
	type PgTableWithColumnsAndSchema,
	schemaToPgColumns,
} from "../helpers/schemaToPgColumns.ts";
import { insertSchema } from "../schemas/insertSchema.ts";
import { updateSchema } from "../schemas/updateSchema.ts";

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
 *
 * @example
 * **Entity with custom Drizzle configuration:**
 * ```ts
 * const Order = $entity({
 *   name: "orders",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     orderNumber: t.text(),
 *     customerId: t.text({ format: "uuid" }),
 *     status: t.enum(["pending", "processing", "shipped", "delivered"]),
 *     totalAmount: t.number({ minimum: 0 }),
 *     currency: t.text({ default: "USD" }),
 *     notes: t.optional(t.text()),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt(),
 *     version: pg.version()
 *   }),
 *   indexes: [
 *     { column: "orderNumber", unique: true },
 *     "customerId",
 *     "status",
 *     "createdAt",
 *     { columns: ["customerId", "status"] }
 *   ],
 *   // Advanced Drizzle ORM configuration
 *   config: (table) => [
 *     // Custom index with specific options
 *     index("idx_orders_amount_status")
 *       .on(table.totalAmount, table.status)
 *       .where(sql`status != 'cancelled'`), // Partial index
 *
 *     // Full-text search index (PostgreSQL specific)
 *     index("idx_orders_search")
 *       .using("gin", table.notes)
 *   ]
 * });
 * ```
 *
 * @stability 2
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
	 *
	 * This name:
	 * - Must be unique within your database schema
	 * - Should follow your database naming conventions (typically snake_case)
	 * - Will be used in generated SQL queries and migrations
	 * - Should be descriptive of the entity's purpose
	 *
	 * **Naming Guidelines**:
	 * - Use plural nouns for table names ("users", "products", "orders")
	 * - Use snake_case for multi-word names ("user_profiles", "order_items")
	 * - Keep names concise but descriptive
	 * - Avoid SQL reserved words
	 *
	 * @example "users"
	 * @example "product_categories"
	 * @example "user_roles"
	 * @example "audit_logs"
	 */
	name: TTableName;

	/**
	 * TypeBox schema defining the table structure and column types.
	 *
	 * This schema:
	 * - Defines all table columns with their types and constraints
	 * - Provides full TypeScript type inference for the entity
	 * - Supports validation rules and default values
	 * - Enables automatic insert/update schema generation
	 * - Must include exactly one primary key field marked with `pg.primaryKey()`
	 *
	 * **Supported PostgreSQL Types**:
	 * - `pg.primaryKey(t.uuid())` - UUID primary key
	 * - `t.text()` - VARCHAR column
	 * - `t.integer()`, `t.number()` - Numeric columns
	 * - `t.boolean()` - Boolean column
	 * - `t.array(t.text())` - PostgreSQL array column
	 * - `t.record(t.text(), t.any())` - JSONB column
	 * - `pg.createdAt()`, `pg.updatedAt()`, `pg.deletedAt()` - Audit timestamps
	 * - `pg.version()` - Optimistic locking version field
	 *
	 * **Schema Best Practices**:
	 * - Always include a primary key
	 * - Use appropriate TypeBox constraints (minLength, format, etc.)
	 * - Add audit fields for trackability
	 * - Use optional fields for nullable columns
	 * - Include foreign key columns for relationships
	 *
	 * @example
	 * ```ts
	 * t.object({
	 *   id: pg.primaryKey(t.uuid()),
	 *   email: t.text({ format: "email" }),
	 *   firstName: t.text({ minLength: 1, maxLength: 100 }),
	 *   lastName: t.text({ minLength: 1, maxLength: 100 }),
	 *   age: t.optional(t.integer({ minimum: 0, maximum: 150 })),
	 *   isActive: t.boolean({ default: true }),
	 *   preferences: t.optional(t.record(t.text(), t.any())),
	 *   tags: t.optional(t.array(t.text())),
	 *   createdAt: pg.createdAt(),
	 *   updatedAt: pg.updatedAt(),
	 *   version: pg.version()
	 * })
	 * ```
	 */
	schema: T;

	/**
	 * Database indexes to create for query optimization.
	 *
	 * Indexes improve query performance but consume disk space and slow down writes.
	 * Choose indexes based on your actual query patterns and performance requirements.
	 *
	 * **Index Types**:
	 * - **Simple string**: Creates a single-column index
	 * - **Single column object**: Creates index on one column with options
	 * - **Multi-column object**: Creates composite index on multiple columns
	 *
	 * **Index Guidelines**:
	 * - Index frequently queried columns (WHERE, ORDER BY, JOIN conditions)
	 * - Create unique indexes for business constraints
	 * - Use composite indexes for multi-column queries
	 * - Index foreign key columns for join performance
	 * - Monitor index usage and remove unused indexes
	 *
	 * **Performance Considerations**:
	 * - Each index increases storage requirements
	 * - Indexes slow down INSERT/UPDATE/DELETE operations
	 * - PostgreSQL can use multiple indexes in complex queries
	 * - Partial indexes can be more efficient for filtered queries
	 *
	 * @example ["email", "createdAt", { column: "username", unique: true }]
	 * @example [{ columns: ["userId", "status"], name: "idx_user_status" }]
	 * @example ["categoryId", { columns: ["price", "inStock"] }]
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
	 *
	 * Foreign keys ensure that values in specified columns must exist in the referenced table.
	 * They prevent orphaned records and maintain database consistency.
	 *
	 * **Foreign Key Benefits**:
	 * - Prevents invalid references to non-existent records
	 * - Maintains data integrity automatically
	 * - Provides clear schema documentation of relationships
	 * - Enables cascade operations (DELETE, UPDATE)
	 *
	 * **Considerations**:
	 * - Foreign keys can impact performance on large tables
	 * - They prevent deletion of referenced records
	 * - Consider cascade options for related data cleanup
	 *
	 * @example
	 * ```ts
	 * foreignKeys: [
	 *   {
	 *     name: "fk_user_role",
	 *     columns: ["roleId"],
	 *     foreignColumns: [Role.id]
	 *   },
	 *   {
	 *     columns: ["createdBy"],
	 *     foreignColumns: [User.id]
	 *   }
	 * ]
	 * ```
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
	const table = pgTable(
		name,
		schemaToPgColumns(schema) as TColumnsMap,
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
