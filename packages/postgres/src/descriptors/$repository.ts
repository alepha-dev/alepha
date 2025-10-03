import type { Static, TObject, TSchema } from "@alepha/core";
import {
	$inject,
	Alepha,
	AlephaError,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	t,
} from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import {
	and,
	arrayContained,
	arrayContains,
	arrayOverlaps,
	asc,
	between,
	desc,
	eq,
	getTableName,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
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
	type TableConfig,
} from "drizzle-orm";
import type {
	LockConfig,
	LockStrength,
	PgColumn,
	PgDatabase,
	PgInsertValue,
	PgTable,
	PgTableWithColumns,
	PgTransaction,
	PgTransactionConfig,
	PgUpdateSetSource,
	SelectedFields,
} from "drizzle-orm/pg-core";
import { isSQLWrapper } from "drizzle-orm/sql/sql";
import postgres from "postgres";
import {
	PG_DELETED_AT,
	PG_PRIMARY_KEY,
	PG_UPDATED_AT,
	PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import { PgConflictError } from "../errors/PgConflictError.ts";
import { PgEntityNotFoundError } from "../errors/PgEntityNotFoundError.ts";
import { PgError } from "../errors/PgError.ts";
import { PgVersionMismatchError } from "../errors/PgVersionMismatchError.ts";
import { getAttrFields, type PgAttrField } from "../helpers/pgAttr.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToPgColumns.ts";
import type { FilterOperators } from "../interfaces/FilterOperators.ts";
import type { PgQuery } from "../interfaces/PgQuery.ts";
import type {
	PgQueryWhere,
	PgQueryWhereOrSQL,
} from "../interfaces/PgQueryWhere.ts";
import {
	PostgresProvider,
	type SQLLike,
} from "../providers/drivers/PostgresProvider.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { PageQuery } from "../schemas/pageQuerySchema.ts";
import type { Page } from "../schemas/pageSchema.ts";
import type { TObjectUpdate } from "../schemas/updateSchema.ts";

import value = postgres.toPascal.value;

/**
 * Creates a repository descriptor for database operations on a defined entity.
 *
 * This descriptor provides a comprehensive, type-safe interface for performing all
 * database operations on entities defined with $entity. It offers a rich set of
 * CRUD operations, advanced querying capabilities, pagination, transactions, and
 * built-in support for audit trails and soft deletes.
 *
 * **Key Features**
 *
 * - **Complete CRUD Operations**: Create, read, update, delete with full type safety
 * - **Advanced Querying**: Complex WHERE conditions, sorting, pagination, and aggregations
 * - **Transaction Support**: Database transactions for consistency and atomicity
 * - **Soft Delete Support**: Built-in soft delete functionality with `pg.deletedAt()` fields
 * - **Optimistic Locking**: Version-based conflict resolution with `pg.version()` fields
 * - **Audit Trail Integration**: Automatic handling of `createdAt`, `updatedAt` timestamps
 * - **Raw SQL Support**: Execute custom SQL queries when needed
 * - **Pagination**: Built-in pagination with metadata and navigation
 *
 * **Important Requirements**
 * - Must be used with an entity created by $entity
 * - Entity schema must include exactly one primary key field
 * - Database tables must be created via migrations before use
 *
 * **Use Cases**
 *
 * Essential for all database-driven applications:
 * - User management and authentication systems
 * - E-commerce product and order management
 * - Content management and blogging platforms
 * - Financial and accounting applications
 * - Any application requiring persistent data storage
 *
 * @example
 * **Basic repository with CRUD operations:**
 * ```ts
 * import { $entity, $repository } from "alepha/postgres";
 * import { pg, t } from "alepha";
 *
 * // First, define the entity
 * const User = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     email: t.string({ format: "email" }),
 *     firstName: t.string(),
 *     lastName: t.string(),
 *     isActive: t.boolean({ default: true }),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt()
 *   }),
 *   indexes: [{ column: "email", unique: true }]
 * });
 *
 * class UserService {
 *   users = $repository({ table: User });
 *
 *   async createUser(userData: { email: string; firstName: string; lastName: string }) {
 *     return await this.users.create({
 *       id: generateUUID(),
 *       email: userData.email,
 *       firstName: userData.firstName,
 *       lastName: userData.lastName,
 *       isActive: true
 *     });
 *   }
 *
 *   async getUserByEmail(email: string) {
 *     return await this.users.findOne({ email });
 *   }
 *
 *   async updateUser(id: string, updates: { firstName?: string; lastName?: string }) {
 *     return await this.users.updateById(id, updates);
 *   }
 *
 *   async deactivateUser(id: string) {
 *     return await this.users.updateById(id, { isActive: false });
 *   }
 * }
 * ```
 *
 * @example
 * **Advanced querying and filtering:**
 * ```ts
 * const Product = $entity({
 *   name: "products",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     name: t.string(),
 *     price: t.number({ minimum: 0 }),
 *     categoryId: t.string({ format: "uuid" }),
 *     inStock: t.boolean(),
 *     tags: t.optional(t.array(t.string())),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt()
 *   }),
 *   indexes: ["categoryId", "inStock", "price"]
 * });
 *
 * class ProductService {
 *   products = $repository({ table: Product });
 *
 *   async searchProducts(filters: {
 *     categoryId?: string;
 *     minPrice?: number;
 *     maxPrice?: number;
 *     inStock?: boolean;
 *     searchTerm?: string;
 *   }, page: number = 0, size: number = 20) {
 *     const query = this.products.createQuery({
 *       where: {
 *         and: [
 *           filters.categoryId ? { categoryId: filters.categoryId } : {},
 *           filters.inStock !== undefined ? { inStock: filters.inStock } : {},
 *           filters.minPrice ? { price: { gte: filters.minPrice } } : {},
 *           filters.maxPrice ? { price: { lte: filters.maxPrice } } : {},
 *           filters.searchTerm ? { name: { ilike: `%${filters.searchTerm}%` } } : {}
 *         ]
 *       },
 *       orderBy: [{ column: "createdAt", direction: "desc" }]
 *     });
 *
 *     return await this.products.paginate({ page, size }, query, { count: true });
 *   }
 *
 *   async getTopSellingProducts(limit: number = 10) {
 *     // Custom SQL query for complex analytics
 *     return await this.products.query(
 *       (table, db) => db
 *         .select({
 *           id: table.id,
 *           name: table.name,
 *           price: table.price,
 *           salesCount: sql<number>`COALESCE(sales.count, 0)`
 *         })
 *         .from(table)
 *         .leftJoin(
 *           sql`(
 *             SELECT product_id, COUNT(*) as count
 *             FROM order_items
 *             WHERE created_at > NOW() - INTERVAL '30 days'
 *             GROUP BY product_id
 *           ) sales`,
 *           sql`sales.product_id = ${table.id}`
 *         )
 *         .orderBy(sql`sales.count DESC NULLS LAST`)
 *         .limit(limit)
 *     );
 *   }
 * }
 * ```
 *
 * @example
 * **Transaction handling and data consistency:**
 * ```ts
 * class OrderService {
 *   orders = $repository({ table: Order });
 *   orderItems = $repository({ table: OrderItem });
 *   products = $repository({ table: Product });
 *
 *   async createOrderWithItems(orderData: {
 *     customerId: string;
 *     items: Array<{ productId: string; quantity: number; price: number }>;
 *   }) {
 *     return await this.orders.transaction(async (tx) => {
 *       // Create the order
 *       const order = await this.orders.create({
 *         id: generateUUID(),
 *         customerId: orderData.customerId,
 *         status: 'pending',
 *         totalAmount: orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
 *       }, { tx });
 *
 *       // Create order items and update product inventory
 *       for (const itemData of orderData.items) {
 *         await this.orderItems.create({
 *           id: generateUUID(),
 *           orderId: order.id,
 *           productId: itemData.productId,
 *           quantity: itemData.quantity,
 *           unitPrice: itemData.price
 *         }, { tx });
 *
 *         // Update product inventory using optimistic locking
 *         const product = await this.products.findById(itemData.productId, { tx });
 *         if (product.stockQuantity < itemData.quantity) {
 *           throw new Error(`Insufficient stock for product ${itemData.productId}`);
 *         }
 *
 *         await this.products.save({
 *           ...product,
 *           stockQuantity: product.stockQuantity - itemData.quantity
 *         }, { tx });
 *       }
 *
 *       return order;
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Soft delete and audit trail:**
 * ```ts
 * const Document = $entity({
 *   name: "documents",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     title: t.string(),
 *     content: t.string(),
 *     authorId: t.string({ format: "uuid" }),
 *     version: pg.version(),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt(),
 *     deletedAt: pg.deletedAt()  // Enables soft delete
 *   })
 * });
 *
 * class DocumentService {
 *   documents = $repository({ table: Document });
 *
 *   async updateDocument(id: string, updates: { title?: string; content?: string }) {
 *     // This uses optimistic locking via the version field
 *     const document = await this.documents.findById(id);
 *     return await this.documents.save({
 *       ...document,
 *       ...updates  // updatedAt will be set automatically
 *     });
 *   }
 *
 *   async softDeleteDocument(id: string) {
 *     // Soft delete - sets deletedAt timestamp
 *     await this.documents.deleteById(id);
 *   }
 *
 *   async permanentDeleteDocument(id: string) {
 *     // Hard delete - actually removes from database
 *     await this.documents.deleteById(id, { force: true });
 *   }
 *
 *   async getActiveDocuments() {
 *     // Automatically excludes soft-deleted records
 *     return await this.documents.find({
 *       where: { authorId: { isNotNull: true } },
 *       orderBy: [{ column: "updatedAt", direction: "desc" }]
 *     });
 *   }
 *
 *   async getAllDocumentsIncludingDeleted() {
 *     // Include soft-deleted records
 *     return await this.documents.find({}, { force: true });
 *   }
 * }
 * ```
 *
 * @example
 * **Complex filtering and aggregation:**
 * ```ts
 * class AnalyticsService {
 *   users = $repository({ table: User });
 *   orders = $repository({ table: Order });
 *
 *   async getUserStatistics(filters: {
 *     startDate?: string;
 *     endDate?: string;
 *     isActive?: boolean;
 *   }) {
 *     const whereConditions = [];
 *
 *     if (filters.startDate) {
 *       whereConditions.push({ createdAt: { gte: filters.startDate } });
 *     }
 *     if (filters.endDate) {
 *       whereConditions.push({ createdAt: { lte: filters.endDate } });
 *     }
 *     if (filters.isActive !== undefined) {
 *       whereConditions.push({ isActive: filters.isActive });
 *     }
 *
 *     const totalUsers = await this.users.count({
 *       and: whereConditions
 *     });
 *
 *     const activeUsers = await this.users.count({
 *       and: [...whereConditions, { isActive: true }]
 *     });
 *
 *     // Complex aggregation query
 *     const recentActivity = await this.users.query(
 *       sql`
 *         SELECT
 *           DATE_TRUNC('day', created_at) as date,
 *           COUNT(*) as new_users,
 *           COUNT(*) FILTER (WHERE is_active = true) as active_users
 *         FROM users
 *         WHERE created_at >= NOW() - INTERVAL '30 days'
 *         GROUP BY DATE_TRUNC('day', created_at)
 *         ORDER BY date DESC
 *       `
 *     );
 *
 *     return {
 *       totalUsers,
 *       activeUsers,
 *       inactiveUsers: totalUsers - activeUsers,
 *       recentActivity
 *     };
 *   }
 * }
 * ```
 *
 * @stability 3
 */
export const $repository = <
	EntityTableConfig extends TableConfig,
	EntitySchema extends TObject,
>(
	optionsOrTable:
		| RepositoryDescriptorOptions<EntityTableConfig, EntitySchema>
		| PgTableWithColumnsAndSchema<EntityTableConfig, EntitySchema>,
): RepositoryDescriptor<EntityTableConfig, EntitySchema> => {
	const options =
		"table" in optionsOrTable
			? (optionsOrTable as RepositoryDescriptorOptions<
					EntityTableConfig,
					EntitySchema
				>)
			: ({
					table: optionsOrTable,
					provider: PostgresProvider,
				} as RepositoryDescriptorOptions<EntityTableConfig, EntitySchema>);

	return createDescriptor(
		RepositoryDescriptor<EntityTableConfig, EntitySchema>,
		options,
	);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RepositoryDescriptorOptions<
	EntityTableConfig extends TableConfig,
	EntitySchema extends TObject,
> {
	/**
	 * The entity table definition created with $entity.
	 *
	 * This table:
	 * - Must be created using the $entity descriptor
	 * - Defines the schema, indexes, and constraints for the repository
	 * - Provides type information for all repository operations
	 * - Must include exactly one primary key field
	 *
	 * The repository will automatically:
	 * - Generate typed CRUD operations based on the entity schema
	 * - Handle audit fields like createdAt, updatedAt, deletedAt
	 * - Support optimistic locking if version field is present
	 * - Provide soft delete functionality if deletedAt field exists
	 *
	 * **Entity Requirements**:
	 * - Must have been created with $entity descriptor
	 * - Schema must include a primary key field marked with `pg.primaryKey()`
	 * - Corresponding database table must exist (created via migrations)
	 *
	 * @example
	 * ```ts
	 * const User = $entity({
	 *   name: "users",
	 *   schema: t.object({
	 *     id: pg.primaryKey(t.uuid()),
	 *     email: t.string({ format: "email" }),
	 *     name: t.string()
	 *   })
	 * });
	 *
	 * const userRepository = $repository({ table: User });
	 * ```
	 */
	table: PgTableWithColumnsAndSchema<EntityTableConfig, EntitySchema>;

	/**
	 * Override the default PostgreSQL database provider.
	 *
	 * By default, the repository will use the injected PostgresProvider from the
	 * dependency injection container. Use this option to:
	 * - Connect to a different database
	 * - Use a specific connection pool
	 * - Implement custom database behavior
	 * - Support multi-tenant architectures with database per tenant
	 *
	 * **Common Use Cases**:
	 * - Multi-database applications
	 * - Read replicas for query optimization
	 * - Different databases for different entity types
	 * - Testing with separate test databases
	 *
	 * @default Uses injected PostgresProvider
	 *
	 * @example ReadOnlyPostgresProvider
	 * @example TenantSpecificPostgresProvider
	 * @example TestDatabaseProvider
	 */
	provider?: Service<PostgresProvider>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class RepositoryDescriptor<
	EntityTableConfig extends TableConfig,
	EntitySchema extends TObject,
> extends Descriptor<
	RepositoryDescriptorOptions<EntityTableConfig, EntitySchema>
> {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly provider = $inject(PostgresProvider);
	public readonly schema = this.options.table.$schema;
	public readonly schemaInsert = this.options.table.$insertSchema;

	/**
	 * Represents the primary key of the table.
	 * - Key is the name of the primary key column.
	 * - Type is the type (TypeBox) of the primary key column.
	 *
	 * ID is mandatory. If the table does not have a primary key, it will throw an error.
	 */
	public readonly id: {
		type: TSchema;
		key: keyof EntitySchema["properties"];
		col: PgColumn;
	} = this.getPrimaryKey(this.schema);

	/**
	 * Get Drizzle table object.
	 */
	public get table(): PgTableWithColumns<EntityTableConfig> {
		return this.options.table;
	}

	/**
	 * Get SQL table name. (from Drizzle table object)
	 */
	public get tableName(): string {
		return getTableName(this.table);
	}

	/**
	 * Getter for the database connection from the database provider.
	 */
	protected get db() {
		return this.provider.db;
	}

	/**
	 * Execute a SQL query.
	 */
	public async query<T extends TObject = EntitySchema>(
		query:
			| SQLLike
			| ((
					table: PgTableWithColumns<EntityTableConfig>,
					db: PgDatabase<any>,
			  ) => SQLLike),
		schema?: T,
	): Promise<Static<T>[]> {
		const raw =
			typeof query === "function" ? query(this.table, this.db) : query;

		if (typeof raw === "string" && raw.includes("[object Object]")) {
			throw new AlephaError(
				"Invalid SQL query. Did you forget to call the 'sql' function?",
			);
		}

		const rows: any[] = await this.provider.execute(raw);

		return rows.map((it) => this.clean(this.mapRawFieldsToEntity(it), schema));
	}

	protected mapRawFieldsToEntity(row: any[]) {
		const entity: any = {};
		for (const key of Object.keys(row)) {
			entity[key] = row[key as any];
			for (const colKey of Object.keys(this.table)) {
				if (this.table[colKey].name === key) {
					entity[colKey] = row[key as any];
					break;
				}
			}
		}
		return entity;
	}

	/**
	 * Get a Drizzle column from the table by his name.
	 *
	 * @param name - The name of the column to get.
	 * @returns The column from the table.
	 */
	protected col(
		name: keyof PgTableWithColumns<EntityTableConfig>["_"]["columns"],
	): PgColumn {
		const column = (this.table as any)[name];
		if (!column) {
			throw new Error(
				`Invalid access. Column ${String(name)} not found in table ${this.tableName}`,
			);
		}

		return column;
	}

	/**
	 * Run a transaction.
	 *
	 * @param transaction
	 * @param config
	 */
	public async transaction<T>(
		transaction: (
			tx: PgTransaction<any, Record<string, any>, any>,
		) => Promise<T>,
		config?: PgTransactionConfig,
	): Promise<T> {
		return await this.db.transaction(transaction, config);
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Start a SELECT query on the table.
	 *
	 * @returns The SELECT query builder.
	 */
	protected select(opts: StatementOptions = {}) {
		return (opts.tx ?? this.db).select().from(this.table as PgTable);
	}

	protected selectDistinct(
		opts: StatementOptions = {},
		fields: SelectedFields,
	) {
		return (opts.tx ?? this.db)
			.selectDistinct(fields)
			.from(this.table as PgTable);
	}

	/**
	 * Start an INSERT query on the table.
	 *
	 * @returns The INSERT query builder.
	 */
	protected insert(opts: StatementOptions = {}) {
		return (opts.tx ?? this.db).insert(this.table);
	}

	/**
	 * Start an UPDATE query on the table.
	 *
	 * @returns The UPDATE query builder.
	 */
	protected update(opts: StatementOptions = {}) {
		return (opts.tx ?? this.db).update(this.table);
	}

	/**
	 * Start a DELETE query on the table.
	 *
	 * @returns The DELETE query builder.
	 */
	protected delete(opts: StatementOptions = {}) {
		return (opts.tx ?? this.db).delete(this.table);
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Find entities.
	 *
	 * @param query The find query.
	 * @param opts The statement options.
	 * @returns The found entities.
	 */
	public async find(
		query: PgQuery<EntitySchema> = {},
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>[]> {
		const builder = query.distinct
			? this.selectDistinct(opts, {} as SelectedFields)
			: this.select(opts);

		const where = this.withDeletedAt(query.where ?? {}, opts);
		builder.where(() => this.jsonQueryToSql(where));

		if (query.offset) {
			builder.offset(query.offset);
		}

		if (query.limit) {
			builder.limit(query.limit);
		}

		if (query.orderBy) {
			const orderByClauses = this.normalizeOrderBy(query.orderBy);
			builder.orderBy(
				...orderByClauses.map((clause) =>
					clause.direction === "desc"
						? desc(this.col(clause.column as string))
						: asc(this.col(clause.column as string)),
				),
			);
		}

		if (query.groupBy) {
			builder.groupBy(...query.groupBy.map((key) => this.col(key as string)));
		}

		if (opts.for) {
			if (typeof opts.for === "string") {
				builder.for(opts.for);
			} else if (opts.for) {
				builder.for(opts.for.strength, opts.for.config);
			}
		}

		try {
			const rows = await builder.execute();
			return rows.map((row) => this.clean(row));
		} catch (error) {
			throw new PgError("Query select has failed", error as Error);
		}
	}

	/**
	 * Find a single entity.
	 *
	 * @param where The where clause.
	 * @param opts The statement options.
	 * @returns The found entity.
	 */
	public async findOne<T extends Static<EntitySchema> = Static<EntitySchema>>(
		where: PgQueryWhere<T>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		const [entity] = await this.find({ where: where as any, limit: 1 }, opts);

		if (!entity) {
			// TODO: enhance error message when finding by ID
			throw new PgEntityNotFoundError(this.tableName);
		}

		return entity;
	}

	/**
	 * Find an entity by ID.
	 */
	public async findById(
		id: string | number,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.findOne(this.getWhereId(id), opts);
	}

	/**
	 * Paginate entities.
	 */
	public async paginate(
		pagination: PageQuery = {},
		query: PgQuery<EntitySchema> = {},
		opts: StatementOptions & { count?: boolean } = {},
	): Promise<Page<Static<EntitySchema>>> {
		const limit = query.limit ?? pagination.size ?? 10;
		const page = pagination.page ?? 0;
		const offset = query.offset ?? page * limit;

		let orderBy = query.orderBy;
		if (!query.orderBy && pagination.sort) {
			orderBy = this.parsePaginationSort(pagination.sort) as any;
		}

		const now = Date.now();
		const timers = {
			query: now,
			count: now,
		};

		const tasks: Promise<any>[] = [];

		tasks.push(
			this.find(
				{
					where: query.where,
					offset,
					limit: limit + 1,
					orderBy,
				},
				opts,
			).then((it) => {
				timers.query = Date.now() - timers.query;
				return it;
			}),
		);

		if (opts.count) {
			const where = isSQLWrapper(query.where)
				? query.where
				: query.where
					? this.jsonQueryToSql(query.where)
					: undefined;

			tasks.push(
				this.db.$count(this.table, where as SQL).then((it) => {
					timers.count = Date.now() - timers.count;
					return it;
				}),
			);
		}

		const [entities, countResult] = await Promise.all(tasks);

		const response = this.createPagination(entities, limit, offset);

		response.page.totalElements = countResult;

		return response;
	}

	public createQuery(query: PgQuery<EntitySchema> = {}): PgQuery<EntitySchema> {
		return {
			...query,
		};
	}

	public createQueryWhere(
		where: PgQueryWhere<Static<EntitySchema>> = {},
	): PgQueryWhere<Static<EntitySchema>> {
		return {
			...where,
		};
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Create an entity.
	 *
	 * @param data The entity to create.
	 * @param opts The options for creating the entity.
	 * @returns The ID of the created entity.
	 */
	public async create(
		data: Static<TObjectInsert<EntitySchema>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.insert(opts)
			.values(this.cast(data, true))
			.returning(this.table)
			.then(([it]) => this.clean(it))
			.catch((error) => {
				throw this.handleError(error, "Insert query has failed");
			});
	}

	/**
	 * Create many entities.
	 *
	 * @param values The entities to create.
	 * @param opts The statement options.
	 * @returns The created entities.
	 */
	public async createMany(
		values: Array<Static<TObjectInsert<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>[]> {
		return await this.insert(opts)
			.values(values.map((data) => this.cast(data, true)))
			.returning(this.table)
			.then((rows) => rows.map((it) => this.clean(it)))
			.catch((error) => {
				throw this.handleError(error, "Insert query has failed");
			});
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Find an entity and update it.
	 */
	public async updateOne(
		where: PgQueryWhereOrSQL<Static<EntitySchema>>,
		data: Partial<Static<TObjectUpdate<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		const set = data as any;

		// do not update the ID field
		delete set[this.id.key];

		const updatedAtField = getAttrFields(this.schema, PG_UPDATED_AT)?.[0];
		if (updatedAtField) {
			set[updatedAtField.key] = (
				opts.now ?? this.dateTimeProvider.now()
			).toISOString();
		}

		where = this.withDeletedAt(where, opts);

		const response = await this.update(opts)
			.set(set)
			.where(this.jsonQueryToSql(where))
			.returning(this.table)
			.catch((error) => {
				throw this.handleError(error, "Update query has failed");
			});

		if (!response[0]) {
			throw new PgEntityNotFoundError(this.tableName);
		}

		try {
			return this.clean(response[0]);
		} catch (error) {
			throw this.handleError(error, "Update query has failed");
		}
	}

	/**
	 * Save a given entity.
	 *
	 * @example
	 * ```ts
	 * const entity = await repository.findById(1);
	 * entity.name = "New Name"; // update a field
	 * delete entity.description; // delete a field
	 * await repository.save(entity);
	 * ```
	 *
	 * Difference with `updateById/updateOne`:
	 *
	 * - requires the entity to be fetched first (whole object is expected)
	 * - check pg.version() if present -> optimistic locking
	 * - validate entity against schema
	 * - undefined values will be set to null, not ignored!
	 *
	 * @see {@link PostgresTypeProvider#version}
	 * @see {@link PgVersionMismatchError}
	 */
	public async save(
		entity: Static<EntitySchema>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		const set = this.alepha.parse(this.schema, entity) as any;
		const id = set[this.id.key];

		// in save mode, we do not ignore undefined values, but set them to null
		for (const key of Object.keys(this.schema.properties)) {
			if (set[key] === undefined) {
				set[key] = null;
			}
		}

		let where = this.createQueryWhere({
			id,
		});

		const versionField = getAttrFields(this.schema, PG_VERSION)?.[0];
		if (versionField && typeof set[versionField.key] === "number") {
			where = {
				and: [
					where,
					{
						[versionField.key]: {
							eq: set[versionField.key],
						},
					},
				],
			} as PgQueryWhere<Static<EntitySchema>>;
			set[versionField.key] += 1;
		}

		try {
			return await this.updateOne(where, set, opts);
		} catch (error) {
			if (error instanceof PgEntityNotFoundError && versionField) {
				await this.findById(id).then(() => {
					throw new PgVersionMismatchError(this.tableName, id);
				});
			}
			throw error;
		}
	}

	/**
	 * Find an entity by ID and update it.
	 */
	public async updateById(
		id: string | number,
		data: Partial<Static<TObjectUpdate<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.updateOne(this.getWhereId(id), data, opts);
	}

	/**
	 * Find many entities and update all of them.
	 */
	public async updateMany(
		where: PgQueryWhereOrSQL<Static<EntitySchema>>,
		data: Partial<Static<TObjectUpdate<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<void> {
		where = this.withDeletedAt(where, opts);
		try {
			await this.update(opts)
				.set(data as PgUpdateSetSource<PgTableWithColumns<EntityTableConfig>>)
				.where(this.jsonQueryToSql(where));
		} catch (error) {
			throw this.handleError(error, "Update query has failed");
		}
	}

	/**
	 * Find many and delete all of them.
	 */
	public async deleteMany(
		where: PgQueryWhere<Static<EntitySchema>> = {},
		opts: StatementOptions = {},
	): Promise<void> {
		const deletedAt = this.deletedAt();
		if (deletedAt && !opts.force) {
			await this.updateMany(
				where,
				{
					[deletedAt.key]: (
						opts.now ?? this.dateTimeProvider.now()
					).toISOString(),
				} as any,
				opts,
			);
			return;
		}

		try {
			await this.delete(opts).where(this.jsonQueryToSql(where));
		} catch (error) {
			throw new PgError("Delete query has failed", error as Error);
		}
	}

	/**
	 * Delete all entities.
	 */
	public clear(opts: StatementOptions = {}) {
		return this.deleteMany({}, opts);
	}

	/**
	 * Delete the given entity.
	 *
	 * You must fetch the entity first in order to delete it.
	 */
	public async destroy(
		entity: Static<EntitySchema>,
		opts: StatementOptions = {},
	) {
		const id = (entity as any)[this.id.key];
		const deletedAt = this.deletedAt();
		if (deletedAt && !opts.force) {
			opts.now ??= this.dateTimeProvider.now();
			(entity as any)[deletedAt.key] = opts.now.toISOString();
		}
		await this.deleteById(id, opts);
	}

	/**
	 * Find an entity and delete it.
	 */
	public async deleteOne(
		where: PgQueryWhere<Static<EntitySchema>> = {},
		opts: StatementOptions = {},
	): Promise<void> {
		await this.deleteMany(where, opts);
	}

	/**
	 * Find an entity by ID and delete it.
	 */
	public async deleteById(
		id: string | number,
		opts: StatementOptions = {},
	): Promise<void> {
		await this.deleteMany(this.getWhereId(id), opts);
	}

	/**
	 * Count entities.
	 */
	public async count(
		where: PgQueryWhereOrSQL<Static<EntitySchema>> = {},
		opts: StatementOptions = {},
	): Promise<number> {
		where = this.withDeletedAt(where, opts);
		return (opts.tx ?? this.db).$count(
			this.table,
			this.jsonQueryToSql(where, this.schema, (key) => this.col(key)),
		);
	}

	// -------------------------------------------------------------------------------------------------------------------

	protected conflictMessagePattern =
		"duplicate key value violates unique constraint";

	protected handleError(error: unknown, message: string): PgError {
		if (!Error.isError(error)) {
			return new PgError(message);
		}

		if (
			(error.cause as Error)?.message.includes(this.conflictMessagePattern) ||
			error.message.includes(this.conflictMessagePattern)
		) {
			return new PgConflictError(message, error);
		}

		return new PgError(message, error);
	}

	protected withDeletedAt(
		where: PgQueryWhereOrSQL<Static<EntitySchema>>,
		opts: {
			force?: boolean;
		} = {},
	) {
		if (opts.force) {
			return where;
		}

		const deletedAt = this.deletedAt();
		if (!deletedAt) {
			return where;
		}

		return {
			and: [
				where,
				{
					[deletedAt.key]: {
						isNull: true,
					},
				} as any,
			],
		} as PgQueryWhere<Static<EntitySchema>>;
	}

	protected get organization() {
		// TODO: organization column for automatic multi-tenancy
		return undefined;
	}

	protected deletedAt(): PgAttrField | undefined {
		const deletedAtFields = getAttrFields(this.schema, PG_DELETED_AT);
		if (deletedAtFields.length > 0) {
			return deletedAtFields[0];
		}
		return undefined;
	}

	/**
	 * Convert a query object to a SQL query.
	 *
	 * @param query The query object.
	 * @param schema The schema to use.
	 * @param col The column to use.
	 */
	protected jsonQueryToSql(
		query: PgQueryWhereOrSQL<Static<EntitySchema>>,
		schema: TObject = this.schema,
		col: (key: string) => PgColumn = (key) => this.col(key),
	): SQL | undefined {
		const conditions: SQL[] = [];

		if (isSQLWrapper(query)) {
			conditions.push(query as SQL);
		} else {
			const keys = Object.keys(query) as Array<
				keyof PgQueryWhere<Static<EntitySchema>> & string
			>;

			for (const key of keys) {
				const operator = query[key];

				if (Array.isArray(operator)) {
					const operations: SQL[] = operator
						.map((it) => {
							if (isSQLWrapper(it)) {
								return it as SQL;
							}
							return this.jsonQueryToSql(
								it as PgQueryWhere<Static<EntitySchema>>,
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
						operator as PgQueryWhere<Static<EntitySchema>>,
						schema,
						col,
					);
					if (where) {
						return not(where);
					}
				}

				if (operator) {
					const column = col(key);
					const sql = this.mapOperatorToSql(operator, column);
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
	 * Map a filter operator to a SQL query.
	 *
	 * @param operator
	 * @param column
	 * @protected
	 */
	protected mapOperatorToSql(
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
			if (this.provider.dialect === "sqlite") {
				conditions.push(like(column, operator.ilike));
			} else {
				conditions.push(ilike(column, operator.ilike));
			}
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

	/**
	 * Create a pagination object.
	 *
	 * @param entities The entities to paginate.
	 * @param limit The limit of the pagination.
	 * @param offset The offset of the pagination.
	 */
	protected createPagination(
		entities: Static<EntitySchema>[],
		limit = 10,
		offset = 0,
	): Page<Static<EntitySchema>> {
		return {
			content: entities.slice(0, limit),
			can: {
				previous: offset > 0,
				next: entities.length === limit + 1,
			},
			page: {
				number: Math.floor(offset / limit),
				size: limit,
			},
		};
	}

	/**
	 * Convert something to valid Pg Insert Value.
	 */
	protected cast(
		data: any,
		insert: boolean,
	): PgInsertValue<PgTableWithColumns<EntityTableConfig>> {
		const schema = insert
			? this.schemaInsert // insert
			: (t.partial(this.schema) as TObject); // update

		// delete undefined values but null values are allowed
		for (const key of Object.keys(data)) {
			if (data[key] === undefined) {
				delete data[key];
			}
		}

		for (const key of Object.keys(schema.properties)) {
			// convert BigInt-string to BigInt
			if (
				t.schema.isBigInt(schema.properties[key]) &&
				typeof data[key] === "string"
			) {
				(data as any)[key] = BigInt(data[key]);
			}
		}

		return this.alepha.parse(schema, data) as PgInsertValue<
			PgTableWithColumns<EntityTableConfig>
		>;
	}

	/**
	 * Clean a row. Remove all null values.
	 *
	 * @param row The row to clean.
	 * @param schema The schema to use.
	 * @returns The cleaned row.
	 */
	protected clean<T extends TObject = EntitySchema>(
		row: any,
		schema?: T,
	): Static<T> {
		const entity = row as Static<T>;
		const schemaRef = schema ?? this.schema;

		for (const key of Object.keys(schemaRef.properties)) {
			const value = schemaRef.properties[key];

			// convert PG date-time and date to ISO strings
			if (typeof entity[key] === "string") {
				if (t.schema.isDatetime(value)) {
					(entity as any)[key] = this.dateTimeProvider
						.of(entity[key])
						.toISOString();
				} else if (t.schema.isDate(value)) {
					(entity as any)[key] = this.dateTimeProvider
						.of(entity[key])
						.toISOString()
						.split("T")[0];
				}
			}

			// convert BigInt to string
			if (typeof entity[key] === "bigint" && t.schema.isBigInt(value)) {
				(entity as any)[key] = entity[key].toString();
			}
		}

		return this.alepha.parse(schemaRef, entity) as Static<T>;
	}

	// -------------------------------------------------------------------------------------------------------------------
	// INTERNAL METHODS

	/**
	 * Parse pagination sort string to orderBy format.
	 * Format: "firstName,-lastName" -> [{ column: "firstName", direction: "asc" }, { column: "lastName", direction: "desc" }]
	 * - Columns separated by comma
	 * - Prefix with '-' for DESC direction
	 *
	 * @param sort Pagination sort string
	 * @returns OrderBy array or single object
	 */
	protected parsePaginationSort(
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
	protected normalizeOrderBy(
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
	 * Get the where clause for an ID.
	 *
	 * @param id The ID to get the where clause for.
	 * @returns The where clause for the ID.
	 */
	protected getWhereId(
		id: string | number,
	): PgQueryWhere<Static<EntitySchema>> {
		return {
			[this.id.key]: {
				eq: t.schema.isString(this.id.type) ? String(id) : Number(id),
			},
		} as PgQueryWhere<Static<EntitySchema>>;
	}

	/**
	 * Find a primary key in the schema.
	 *
	 * @param schema
	 * @protected
	 */
	protected getPrimaryKey(schema: TObject) {
		const primaryKeys = getAttrFields(schema, PG_PRIMARY_KEY);
		if (primaryKeys.length === 0) {
			throw new Error("Primary key not found in schema");
		}

		if (primaryKeys.length > 1) {
			throw new Error(
				`Multiple primary keys (${primaryKeys.length}) are not supported`,
			);
		}

		return {
			key: primaryKeys[0].key,
			col: this.col(primaryKeys[0].key),
			type: primaryKeys[0].type,
		};
	}
}

$repository[KIND] = RepositoryDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The options for a statement.
 */
export interface StatementOptions {
	/**
	 * Transaction to use.
	 */
	tx?: PgTransaction<any, Record<string, any>>;

	/**
	 * Lock strength.
	 */
	for?: LockStrength | { config: LockConfig; strength: LockStrength };

	/**
	 * If true, ignore soft delete.
	 */
	force?: boolean;

	/**
	 * Force the current time.
	 */
	now?: DateTime;
}
