import {
	$env,
	$inject,
	Alepha,
	AlephaError,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	t,
} from "@alepha/core";
import type { Static, TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
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
import {
	PG_PRIMARY_KEY,
	PG_UPDATED_AT,
	PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import { PgConflictError } from "../errors/PgConflictError.ts";
import { PgEntityNotFoundError } from "../errors/PgEntityNotFoundError.ts";
import { PgError } from "../errors/PgError.ts";
import { PgVersionMismatchError } from "../errors/PgVersionMismatchError.ts";
import type { NullifyIfOptional } from "../helpers/nullToUndefined.ts";
import { nullToUndefined } from "../helpers/nullToUndefined.ts";
import { getAttrFields } from "../helpers/pgAttr.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToPgColumns.ts";
import type { FilterOperators } from "../interfaces/FilterOperators.ts";
import type { InferInsert } from "../interfaces/InferInsert.ts";
import type { PgQuery, PgQueryResult } from "../interfaces/PgQuery.ts";
import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";
import {
	PostgresProvider,
	type SQLLike,
} from "../providers/drivers/PostgresProvider.ts";
import type { PageQuery } from "../schemas/pageQuerySchema.ts";
import type { Page } from "../schemas/pageSchema.ts";

/**
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
	 * The table to create the repository for.
	 */
	table: PgTableWithColumnsAndSchema<EntityTableConfig, EntitySchema>;

	/**
	 * Override default provider.
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
	public readonly provider = $inject(PostgresProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly schema = this.options.table.$schema;
	public readonly insertSchema = this.options.table.$insertSchema;

	// TODO: replace with .paginate(withCount=false)
	protected readonly env = $env(
		t.object({
			POSTGRES_PAGINATION_COUNT_ENABLED: t.boolean({ default: true }),
		}),
	);

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
	 *
	 * @param query
	 * @param schema
	 */
	public async execute<T extends TObject = EntitySchema>(
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

		return await this.provider.execute(raw).then((rows) => {
			return rows.map((it: any) => this.clean(it, schema) as Static<T>);
		});
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
	public async find<Select extends (keyof Static<EntitySchema>)[]>(
		query: PgQuery<EntitySchema, Select> = {},
		opts: StatementOptions = {},
	): Promise<Static<PgQueryResult<EntitySchema, Select>>[]> {
		let schema: TObject | undefined;

		if (typeof query.columns === "object") {
			schema = t.pick(this.schema, query.columns) as TObject;
		}

		const builder = query.distinct
			? this.selectDistinct(
					opts,
					typeof query.columns === "undefined"
						? {}
						: query.columns.reduce((acc, key) => {
								const col = this.col(key);
								return {
									...acc,
									[col.name]: col,
								};
							}, {} as SelectedFields),
				)
			: this.select(opts);

		if (query.where) {
			if (isSQLWrapper(query.where)) {
				builder.where(() => query.where as SQL);
			} else {
				const where = query.where;
				builder.where(() => this.jsonQueryToSql(where));
			}
		}

		if (query.offset) {
			builder.offset(query.offset);
		}

		if (query.limit) {
			builder.limit(query.limit);
		}

		if (query.sort) {
			builder.orderBy(
				...Object.entries(query.sort ?? {}).map(([k, v]) =>
					v === "asc" ? asc(this.col(k)) : desc(this.col(k)),
				),
			);
		}

		if (query.groupBy) {
			builder.groupBy(...query.groupBy.map((key) => this.col(key)));
		}

		if (opts.for) {
			if (typeof opts.for === "string") {
				builder.for(opts.for);
			} else if (opts.for) {
				builder.for(opts.for.strength, opts.for.config);
			}
		}

		// TODO: hook for enhancing the query (organization, soft delete, etc.)

		try {
			const rows = await builder.execute();
			return rows.map((row) => this.clean(row, schema));
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
	 * @alias findOne.
	 */
	public one = this.findOne.bind(this);

	/**
	 * Find an entity by ID.
	 *
	 * @param id
	 * @param opts
	 */
	public async findById(
		id: string | number,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.findOne(this.getWhereId(id), opts);
	}

	/**
	 * Paginate entities.
	 *
	 * @param pageQuery The pagination query.
	 * @param findQuery The find query.
	 * @param opts The statement options.
	 * @returns The paginated entities.
	 */
	public async paginate(
		pageQuery: PageQuery = {},
		findQuery: PgQuery<EntitySchema> = {},
		opts: StatementOptions = {},
	): Promise<Page<Static<EntitySchema>>> {
		const limit = findQuery.limit ?? pageQuery.size ?? 10;
		const page = pageQuery.page ?? 0;
		const offset = findQuery.offset ?? page * limit;

		let sort = findQuery.sort;
		if (!findQuery.sort) {
			if (pageQuery.sort) {
				const [field, type] = pageQuery.sort.split(",");
				sort = { [field]: type === "desc" ? "desc" : "asc" } as any;
			} else {
				sort = {};
			}
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
					where: findQuery.where,
					offset,
					limit: limit + 1,
					sort,
				},
				opts,
			).then((it) => {
				timers.query = Date.now() - timers.query;
				return it;
			}),
		);

		if (this.env.POSTGRES_PAGINATION_COUNT_ENABLED) {
			const where = isSQLWrapper(findQuery.where)
				? findQuery.where
				: findQuery.where
					? this.jsonQueryToSql(findQuery.where)
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
		response.page.countDuration = timers.count;
		response.page.queryDuration = timers.query;

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
		data: InferInsert<EntitySchema>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.insert(opts)
			.values(this.cast(data, true))
			.returning(this.table)
			.then(([it]) => this.clean(it))
			.catch((error) => {
				if (error instanceof Error) {
					const msg = "duplicate key value violates unique constraint";
					if (
						(error.cause as Error)?.message.includes(msg) ||
						error.message.includes(msg)
					) {
						throw new PgConflictError("Entity already exists", error);
					}
					throw new PgError("Failed to create entity", error);
				}
				throw error;
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
		values: Array<InferInsert<EntitySchema>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>[]> {
		return await this.insert(opts)
			.values(values.map((data) => this.cast(data, true)))
			.returning(this.table) // TODO: return only the ID
			.then((rows) => rows.map((it) => this.clean(it)));
	}

	/**
	 * Update an entity.
	 *
	 * @param query The where clause.
	 * @param data The data to update.
	 * @param opts The statement options.
	 * @returns The updated entity.
	 */
	public async updateOne(
		query: PgQueryWhere<Static<EntitySchema>>,
		data:
			| Partial<NullifyIfOptional<Static<EntitySchema>>>
			| { $append: Partial<NullifyIfOptional<Static<EntitySchema>>> },
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		const set = data as any;

		const updatedAtFields = getAttrFields(this.schema, PG_UPDATED_AT);
		for (const updatedAtField of updatedAtFields) {
			set[updatedAtField.key] = new Date().toISOString();
		}

		const versionFields = getAttrFields(this.schema, PG_VERSION);
		for (const versionField of versionFields) {
			if (set[versionField.key] != null) {
				set[versionField.key] = set[versionField.key] + 1;
			}
		}

		const id = set[this.id.key];

		delete set[this.id.key];

		const hasVersion = versionFields.length > 0 && set[versionFields[0].key];
		const where = hasVersion
			? ({
					and: [
						query,
						{
							[versionFields[0].key]: {
								eq: set[versionFields[0].key] - 1,
							},
						},
					],
				} as PgQueryWhere<Static<EntitySchema>>)
			: query;

		const response = await this.update(opts)
			.set(set)
			.where(this.jsonQueryToSql(where))
			.returning(this.table);

		if (!response[0]) {
			if (hasVersion && id) {
				await this.findById(id).then(() => {
					throw new PgVersionMismatchError(this.tableName, id);
				});
			}

			throw new PgEntityNotFoundError(this.tableName);
		}

		return this.clean(response[0]);
	}

	public async save(
		data: Static<EntitySchema>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		const set = { ...data } as any;
		const id = set[this.id.key];
		return await this.updateById(id, set, opts);
	}

	/**
	 * Update an entity by ID.
	 *
	 * @param id
	 * @param data
	 * @param opts
	 */
	public async updateById(
		id: string | number,
		data: Partial<NullifyIfOptional<Static<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<Static<EntitySchema>> {
		return await this.updateOne(this.getWhereId(id), data, opts);
	}

	/**
	 * Update entities.
	 *
	 * @param where The where clause.
	 * @param data The data to update.
	 * @param opts The statement options.
	 * @returns The updated entities.
	 */
	public async updateMany(
		where: PgQueryWhere<Static<EntitySchema>>,
		data: Partial<NullifyIfOptional<Static<EntitySchema>>>,
		opts: StatementOptions = {},
	): Promise<void> {
		await this.update(opts)
			.set(data as PgUpdateSetSource<PgTableWithColumns<EntityTableConfig>>)
			.where(this.jsonQueryToSql(where));
	}

	/**
	 * Delete entities.
	 *
	 * @param where Query.
	 * @param opts The statement options.
	 */
	public async deleteMany(
		where: PgQueryWhere<Static<EntitySchema>> = {},
		opts: StatementOptions = {},
	): Promise<void> {
		await this.delete(opts).where(this.jsonQueryToSql(where));
	}

	/**
	 * Delete all entities.
	 */
	public clear(opts: StatementOptions = {}) {
		return this.deleteMany({}, opts);
	}

	/**
	 * Delete an entity by ID.
	 *
	 * @param id
	 * @param opts
	 */
	public async deleteById(
		id: string | number,
		opts: StatementOptions = {},
	): Promise<void> {
		try {
			await this.deleteMany(this.getWhereId(id), opts);
		} catch (error) {
			if (error instanceof Error) {
				throw new PgError(
					`Failed to delete entity ${id} - ${error.message}`,
					error,
				);
			}
			throw error;
		}
	}

	/**
	 * Count entities.
	 *
	 * @param where The where clause.
	 * @param opts The statement options.
	 * @returns The count of entities.
	 */
	public async count(
		where: PgQueryWhere<Static<EntitySchema>> = {},
		opts: StatementOptions = {},
	): Promise<number> {
		return (opts.tx ?? this.db).$count(
			this.table,
			this.jsonQueryToSql(where, this.schema, (key) => this.col(key)),
		);
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Convert a query object to a SQL query.
	 *
	 * @param query The query object.
	 * @param schema The schema to use.
	 * @param col The column to use.
	 */
	protected jsonQueryToSql(
		query: PgQueryWhere<Static<EntitySchema>>,
		schema: TObject = this.schema,
		col: (key: string) => PgColumn = (key) => this.col(key),
	): SQL | undefined {
		const conditions: SQL[] = [];
		const keys = Object.keys(query) as Array<
			keyof PgQueryWhere<Static<EntitySchema>> & string
		>;

		for (const key of keys) {
			const operator = query[key];

			if (Array.isArray(operator)) {
				const operations = operator.map((it) => {
					if (isSQLWrapper(it)) {
						return it as SQL;
					}
					return this.jsonQueryToSql(
						it as PgQueryWhere<Static<EntitySchema>>,
						schema,
						col,
					);
				});

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

		if (operator?.eq != null) {
			return eq(column, operator.eq);
		}

		if (operator?.ne != null) {
			return ne(column, operator.ne);
		}

		if (operator?.gt != null) {
			return gt(column, operator.gt);
		}

		if (operator?.gte != null) {
			return gte(column, operator.gte);
		}

		if (operator?.lt != null) {
			return lt(column, operator.lt);
		}

		if (operator?.lte != null) {
			return lte(column, operator.lte);
		}

		if (operator?.inArray != null) {
			return inArray(column, operator.inArray);
		}

		if (operator?.notInArray != null) {
			return notInArray(column, operator.notInArray);
		}

		if (operator?.isNull != null) {
			return isNull(column);
		}

		if (operator?.isNotNull != null) {
			return isNotNull(column);
		}

		if (operator?.like != null) {
			return like(column, operator.like);
		}

		if (operator?.notLike != null) {
			return notLike(column, operator.notLike);
		}

		if (operator?.ilike != null) {
			if (this.provider.dialect === "sqlite") {
				return like(column, operator.ilike);
			}
			return ilike(column, operator.ilike);
		}

		if (operator?.notIlike != null) {
			return notIlike(column, operator.notIlike);
		}

		if (operator?.between != null) {
			return between(column, operator.between[0], operator.between[1]);
		}

		if (operator?.notBetween != null) {
			return notBetween(column, operator.notBetween[0], operator.notBetween[1]);
		}

		if (operator?.arrayContains != null) {
			return arrayContains(column, operator.arrayContains);
		}

		if (operator?.arrayContained != null) {
			return arrayContained(column, operator.arrayContains);
		}

		if (operator?.arrayOverlaps != null) {
			return arrayOverlaps(column, operator.arrayContains);
		}
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
		const schema = insert ? this.insertSchema : this.schema;

		const versionFields = getAttrFields(this.schema, PG_VERSION);
		for (const versionField of versionFields) {
			if (insert) {
				(data as any)[versionField.key] = 0;
			} else {
				(data as any)[versionField.key] = (data as any)[versionField.key] + 1;
			}
		}

		for (const key of Object.keys(data)) {
			if (data[key] === undefined) {
				delete data[key];
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
		const entity = nullToUndefined(row) as Static<T>;
		const schemaRef = schema ?? this.schema;

		for (const key of Object.keys(schemaRef.properties)) {
			const value = schemaRef.properties[key];
			if (value.format === "date-time" && typeof entity[key] === "string") {
				(entity as any)[key] = new Date(entity[key]).toISOString();
			}
			if (value.format === "date" && typeof entity[key] === "string") {
				(entity as any)[key] = new Date(entity[key])
					.toISOString()
					.split("T")[0];
			}
		}

		return this.alepha.parse(schemaRef, entity) as Static<T>;
	}

	// -------------------------------------------------------------------------------------------------------------------
	// INTERNAL METHODS

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
			[this.id.key]: { eq: Value.Convert(this.id.type, id) },
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
}
