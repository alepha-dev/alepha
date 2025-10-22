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
  asc,
  desc,
  getTableName,
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
} from "drizzle-orm/pg-core";
import { isSQLWrapper } from "drizzle-orm/sql/sql";
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
import { type PgJoin, PgQueryManager } from "../helpers/PgQueryManager.ts";
import { PgRelationManager } from "../helpers/PgRelationManager.ts";
import { getAttrFields, type PgAttrField } from "../helpers/pgAttr.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToPgColumns.ts";
import type {
  PgQuery,
  PgQueryRelations,
  PgRelationMap,
  PgStatic,
} from "../interfaces/PgQuery.ts";
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

/**
 * Creates a repository for database operations on a defined entity.
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
 * @example
 * **Basic repository with CRUD operations:**
 * ```ts
 * import { $entity, $repository } from "alepha/postgres";
 * import { pg, t } from "alepha";
 *
 * // First, define the entity
 * const users = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     email: t.text({ format: "email" }),
 *     firstName: t.text(),
 *     lastName: t.text(),
 *     isActive: pg.default(t.boolean(), true),
 *     createdAt: pg.createdAt(),
 *     updatedAt: pg.updatedAt()
 *   }),
 *   indexes: [{ column: "email", unique: true }]
 * });
 *
 * class UserService {
 *   users = $repository(users);
 *
 *   async createUser(userData: { email: string; firstName: string; lastName: string }) {
 *     return await this.users.create({
 *       id: generateUUID(),
 *       email: userData.email,
 *       firstName: userData.firstName,
 *       lastName: userData.lastName
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
   *     email: t.text({ format: "email" }),
   *     name: t.text()
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
  protected readonly pgRelationManager = $inject(PgRelationManager);
  protected readonly pgQueryManager = $inject(PgQueryManager);
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
   *
   * This method allows executing raw SQL queries against the database.
   * This is by far the easiest way to run custom queries that are not covered by the repository's built-in methods!
   *
   * You must use the `sql` tagged template function from Drizzle ORM to create the query. https://orm.drizzle.team/docs/sql
   *
   * @example
   * ```ts
   * const users = $entity({ ... });
   * const result = await repository.query(sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`, users.$schema);
   * ```
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

    const rows: Record<string, unknown>[] = await this.provider.execute(raw);

    return rows.map((it) => {
      return this.clean(this.mapRawFieldsToEntity(it), schema);
    });
  }

  /**
   * Map raw database fields to entity fields. (handles column name differences)
   */
  protected mapRawFieldsToEntity(row: Record<string, unknown>) {
    const entity: any = {};

    for (const key of Object.keys(row)) {
      entity[key] = row[key];
      for (const colKey of Object.keys(this.table)) {
        if (this.table[colKey].name === key) {
          entity[colKey] = row[key];
          break;
        }
      }
    }

    return entity;
  }

  /**
   * Get a Drizzle column from the table by his name.
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
   */
  protected select(opts: StatementOptions = {}) {
    return (opts.tx ?? this.db).select().from(this.table as PgTable);
  }

  /**
   * Start a SELECT DISTINCT query on the table.
   */
  protected selectDistinct(
    opts: StatementOptions = {},
    columns: (keyof Static<EntitySchema>)[] = [],
  ) {
    const db = opts.tx ?? this.db;
    const table = this.table as PgTable;

    const fields: Record<string, any> = {};
    for (const column of columns) {
      if (typeof column === "string") {
        fields[column] = this.col(column);
      }
    }

    return db.selectDistinct(fields).from(table);
  }

  /**
   * Start an INSERT query on the table.
   */
  protected insert(opts: StatementOptions = {}) {
    return (opts.tx ?? this.db).insert(this.table);
  }

  /**
   * Start an UPDATE query on the table.
   */
  protected update(opts: StatementOptions = {}) {
    return (opts.tx ?? this.db).update(this.table);
  }

  /**
   * Start a DELETE query on the table.
   */
  protected delete(opts: StatementOptions = {}) {
    return (opts.tx ?? this.db).delete(this.table);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Create a Drizzle `select` query based on a JSON query object.
   *
   * > This method is the base for `find`, `findOne`, `findById`, and `paginate`.
   */
  public async find<R extends PgRelationMap<EntitySchema>>(
    query: PgQueryRelations<EntitySchema, R> = {},
    opts: StatementOptions = {},
  ): Promise<PgStatic<EntitySchema, R>[]> {
    const columns = query.columns ?? query.distinct;
    const builder = query.distinct
      ? this.selectDistinct(opts, query.distinct)
      : this.select(opts);

    const joins: Array<PgJoin> = [];
    if (query.with) {
      this.pgRelationManager.buildJoins(
        builder,
        joins,
        query.with,
        this.table as PgTableWithColumnsAndSchema<any, any>,
      );
    }

    const where = this.withDeletedAt(
      (query.where ?? {}) as PgQueryWhere<EntitySchema>,
      opts,
    );

    builder.where(() => this.toSQL(where, joins));

    if (query.offset) {
      builder.offset(query.offset);
    }

    if (query.limit) {
      builder.limit(query.limit);
    }

    if (query.orderBy) {
      const orderByClauses = this.pgQueryManager.normalizeOrderBy(
        query.orderBy,
      );
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
      let rows = await builder.execute();

      let schema: TObject = this.schema;
      if (columns) {
        schema = t.pick(schema, columns);
      }

      if (joins.length) {
        rows = rows.map((row: any) => {
          schema = t.omit(schema, []); // clone schema
          return this.pgRelationManager.mapRowWithJoins(
            row[this.tableName],
            row,
            schema,
            joins,
          );
        });
      }

      return rows.map((row) => this.clean(row, schema)) as PgStatic<
        EntitySchema,
        R
      >[];
    } catch (error) {
      throw new PgError("Query select has failed", error as Error);
    }
  }

  /**
   * Find a single entity.
   */
  public async findOne<R extends PgRelationMap<EntitySchema>>(
    query: Pick<PgQueryRelations<EntitySchema, R>, "with" | "where">,
    opts: StatementOptions = {},
  ): Promise<PgStatic<EntitySchema, R>> {
    const [entity] = await this.find({ limit: 1, ...query }, opts);

    if (!entity) {
      // TODO: enhance error message when finding by ID
      throw new PgEntityNotFoundError(this.tableName);
    }

    return entity as PgStatic<EntitySchema, R>;
  }
  public one = this.findOne;

  /**
   * Find entities with pagination.
   *
   * It uses the same parameters as `find()`, but adds pagination metadata to the response.
   *
   * > Pagination CAN also do a count query to get the total number of elements.
   */
  public async paginate<R extends PgRelationMap<EntitySchema>>(
    pagination: PageQuery = {},
    query: PgQueryRelations<EntitySchema, R> = {},
    opts: StatementOptions & { count?: boolean } = {},
  ): Promise<Page<PgStatic<EntitySchema, R>>> {
    const limit = query.limit ?? pagination.size ?? 10;
    const page = pagination.page ?? 0;
    const offset = query.offset ?? page * limit;

    let orderBy = query.orderBy;
    if (!query.orderBy && pagination.sort) {
      orderBy = this.pgQueryManager.parsePaginationSort(pagination.sort) as any;
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
          offset,
          limit: limit + 1,
          orderBy,
          ...query,
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
          ? this.toSQL(query.where)
          : undefined;

      tasks.push(
        this.db.$count(this.table, where as SQL).then((it) => {
          timers.count = Date.now() - timers.count;
          return it;
        }),
      );
    }

    const [entities, countResult] = await Promise.all(tasks);

    const response = this.pgQueryManager.createPagination<EntitySchema>(
      entities,
      limit,
      offset,
    );

    response.page.totalElements = countResult;

    return response as Page<PgStatic<EntitySchema, R>>;
  }

  /**
   * Find an entity by ID.
   *
   * This is a convenience method for `findOne` with a where clause on the primary key.
   * If you need more complex queries, use `findOne` instead.
   */
  public async findById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Static<EntitySchema>> {
    return await this.findOne(
      {
        where: this.getWhereId(id),
      },
      opts,
    );
  }

  /**
   * Helper to create a type-safe query object.
   */
  public createQuery(): PgQuery<EntitySchema> {
    return {};
  }

  /**
   * Helper to create a type-safe where clause.
   */
  public createQueryWhere(): PgQueryWhere<EntitySchema> {
    return {};
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
    where: PgQueryWhereOrSQL<EntitySchema>,
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
      .where(this.toSQL(where))
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
    if (id == null) {
      throw new AlephaError("Cannot save entity without ID");
    }

    // in save mode, we do not ignore undefined values, but set them to null
    for (const key of Object.keys(this.schema.properties)) {
      if (set[key] === undefined) {
        set[key] = null;
      }
    }

    let where: any = this.createQueryWhere();

    where.id = { eq: id };

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
      } as PgQueryWhere<EntitySchema>;

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
    where: PgQueryWhereOrSQL<EntitySchema>,
    data: Partial<Static<TObjectUpdate<EntitySchema>>>,
    opts: StatementOptions = {},
  ): Promise<void> {
    where = this.withDeletedAt(where, opts);
    try {
      await this.update(opts)
        .set(data as PgUpdateSetSource<PgTableWithColumns<EntityTableConfig>>)
        .where(this.toSQL(where));
    } catch (error) {
      throw this.handleError(error, "Update query has failed");
    }
  }

  /**
   * Find many and delete all of them.
   */
  public async deleteMany(
    where: PgQueryWhereOrSQL<EntitySchema> = {},
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
      await this.delete(opts).where(this.toSQL(where));
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
    if (id == null) {
      throw new AlephaError("Cannot destroy entity without ID");
    }

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
    where: PgQueryWhereOrSQL<EntitySchema> = {},
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
    where: PgQueryWhereOrSQL<EntitySchema> = {},
    opts: StatementOptions = {},
  ): Promise<number> {
    where = this.withDeletedAt(where, opts);
    return (opts.tx ?? this.db).$count(this.table, this.toSQL(where));
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected conflictMessagePattern =
    "duplicate key value violates unique constraint";

  protected handleError(error: unknown, message: string): PgError {
    if (!(error instanceof Error)) {
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
    where: PgQueryWhereOrSQL<EntitySchema>,
    opts: {
      force?: boolean;
    } = {},
  ): PgQueryWhereOrSQL<EntitySchema> {
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
    } as PgQueryWhereOrSQL<EntitySchema>;
  }

  protected deletedAt(): PgAttrField | undefined {
    const deletedAtFields = getAttrFields(this.schema, PG_DELETED_AT);
    if (deletedAtFields.length > 0) {
      return deletedAtFields[0];
    }
    return undefined;
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
   * Transform a row from the database into a clean entity.
   *
   * - Validate against schema
   * - Replace all null values by undefined
   * - Fix date-time and date fields to ISO strings
   * - Cast BigInt to string
   */
  protected clean<T extends TObject = EntitySchema>(
    row: Record<string, unknown>,
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
            .of(`${entity[key]}T00:00:00Z`)
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

  protected toSQL(
    where: PgQueryWhereOrSQL<EntitySchema>,
    joins?: PgJoin[],
  ): SQL | undefined {
    return this.pgQueryManager.toSQL(where as PgQueryWhereOrSQL<EntitySchema>, {
      schema: this.schema,
      col: (name) => {
        return this.col(name);
      },
      joins,
    });
  }

  /**
   * Get the where clause for an ID.
   *
   * @param id The ID to get the where clause for.
   * @returns The where clause for the ID.
   */
  protected getWhereId(id: string | number): PgQueryWhere<EntitySchema> {
    return {
      [this.id.key]: {
        eq: t.schema.isString(this.id.type) ? String(id) : Number(id),
      },
    } as PgQueryWhere<EntitySchema>;
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
