import {
  $inject,
  Alepha,
  AlephaError,
  type Page,
  type PageQuery,
  type Static,
  type StaticEncode,
  type TObject,
  type TSchema,
  t,
} from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  asc,
  avg,
  count,
  desc,
  and as drizzleAnd,
  eq as drizzleEq,
  gt,
  gte,
  lt,
  lte,
  max,
  min,
  ne,
  type SQL,
  sum,
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
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import {
  PG_DELETED_AT,
  PG_PRIMARY_KEY,
  PG_UPDATED_AT,
  PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import { DbColumnNotFoundError } from "../errors/DbColumnNotFoundError.ts";
import { DbConflictError } from "../errors/DbConflictError.ts";
import { DbDeadlockError } from "../errors/DbDeadlockError.ts";
import { DbEntityNotFoundError } from "../errors/DbEntityNotFoundError.ts";
import { DbError } from "../errors/DbError.ts";
import { DbForeignKeyError } from "../errors/DbForeignKeyError.ts";
import { DbNotNullError } from "../errors/DbNotNullError.ts";
import { DbTableNotFoundError } from "../errors/DbTableNotFoundError.ts";
import { DbVersionMismatchError } from "../errors/DbVersionMismatchError.ts";
import { getAttrFields, type PgAttrField } from "../helpers/pgAttr.ts";
import type {
  AggregateOp,
  AggregateQuery,
  AggregateResult,
  AggregateSelect,
} from "../interfaces/AggregateQuery.ts";
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
import type {
  EntityPrimitive,
  SchemaToTableConfig,
} from "../primitives/$entity.ts";
import { DbCacheProvider } from "../providers/DbCacheProvider.ts";
import {
  DatabaseProvider,
  type SQLLike,
} from "../providers/drivers/DatabaseProvider.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { TObjectUpdate } from "../schemas/updateSchema.ts";
import { PgRelationManager } from "./PgRelationManager.ts";
import { type PgJoin, QueryManager } from "./QueryManager.ts";

export abstract class Repository<T extends TObject> {
  public readonly entity: EntityPrimitive<T>;
  public readonly provider: DatabaseProvider;

  protected readonly log = $logger();
  protected readonly relationManager = $inject(PgRelationManager);
  protected readonly queryManager = $inject(QueryManager);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly dbCache = new DbCacheProvider();
  protected readonly alepha = $inject(Alepha);

  static of<T extends TObject>(
    entity: EntityPrimitive<T>,
    provider = DatabaseProvider,
  ): new () => Repository<T> {
    return class InlineRepository extends Repository<T> {
      constructor() {
        super(entity, provider);
      }
    };
  }

  constructor(entity: EntityPrimitive<T>, provider = DatabaseProvider) {
    this.entity = entity;
    this.provider = this.alepha.inject(provider);
    if ((entity as any).isView) {
      this.provider.registerView(entity as any);
    } else {
      this.provider.registerEntity(entity as EntityPrimitive);
    }
  }

  /**
   * Represents the primary key of the table.
   * - Key is the name of the primary key column.
   * - Type is the type (TypeBox) of the primary key column.
   *
   * ID is mandatory. If the table does not have a primary key, it will throw an error.
   */
  public get id(): {
    type: TSchema;
    key: keyof T["properties"];
    col: PgColumn;
  } {
    return this.getPrimaryKey(this.entity.schema);
  }

  /**
   * Get Drizzle table object.
   */
  public get table(): PgTableWithColumns<SchemaToTableConfig<T>> {
    return this.provider.table(this.entity);
  }

  /**
   * Get SQL table name. (from Drizzle table object)
   */
  public get tableName(): string {
    return this.entity.name;
  }

  /**
   * Whether this repository is backed by a view (read-only).
   */
  public get isReadOnly(): boolean {
    return (this.entity as any).isView === true;
  }

  /**
   * Getter for the database connection from the database provider.
   *
   * Automatically picks up a transaction from `alepha.store` if one was set
   * by `DatabaseProvider.transactional()`, so that all repository operations
   * inside a `transactional()` block participate in the same transaction.
   */
  protected get db(): PgDatabase<any> {
    const tx = this.alepha.get("alepha.orm.tx");
    return tx ?? this.provider.db;
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
   * class App {
   *   repository = $repository({ ... });
   *   async getAdults() {
   *     const users = repository.table; // Drizzle table object
   *     await repository.query(sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`);
   *     // or better
   *     await repository.query((users) => sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`);
   *   }
   * }
   * ```
   */
  public async query<R extends TObject = T>(
    query:
      | SQLLike
      | ((
          table: PgTableWithColumns<SchemaToTableConfig<T>>,
          db: PgDatabase<any>,
        ) => SQLLike),
    schema?: R,
  ): Promise<Static<R>[]> {
    const raw =
      typeof query === "function" ? query(this.table, this.db) : query;

    if (typeof raw === "string" && raw.includes("[object Object]")) {
      throw new AlephaError(
        "Invalid SQL query. Did you forget to call the 'sql' function?",
      );
    }

    // Only wrap database execution errors, not post-processing errors (e.g., TypeBoxError)
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.provider.execute(raw);
    } catch (error) {
      throw this.handleError(error, "Custom query has failed");
    }

    if (rows == null) {
      return [];
    }

    if (!Array.isArray(rows)) {
      throw new DbError(
        "Invalid query result. Expected an array of rows, but got: " +
          JSON.stringify(rows),
      );
    }

    return rows.map((it) => {
      return this.clean(
        this.mapRawFieldsToEntity(it),
        schema ?? this.entity.schema,
      ) as Static<R>;
    });
  }

  private _columnNameMap?: Map<string, string>;

  /**
   * Map raw database fields to entity fields. (handles column name differences)
   */
  protected mapRawFieldsToEntity(row: Record<string, unknown>) {
    if (!this._columnNameMap) {
      this._columnNameMap = new Map();
      for (const colKey of Object.keys(this.table)) {
        this._columnNameMap.set(this.table[colKey].name, colKey);
      }
    }

    const entity: any = {};

    for (const key of Object.keys(row)) {
      entity[key] = row[key];
      const fieldKey = this._columnNameMap.get(key);
      if (fieldKey) {
        entity[fieldKey] = row[key];
      }
    }

    return entity;
  }

  /**
   * Get a Drizzle column from the table by his name.
   */
  protected col(name: keyof StaticEncode<T>): PgColumn {
    const column = (this.table as any)[name];
    if (!column) {
      throw new AlephaError(
        `Invalid access. Column '${String(name)}' not found in table '${this.tableName}'`,
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
    if (!this.provider.supportsTransactions) {
      this.log.warn(
        `Transactions are not supported with ${this.provider.driver} driver`,
      );
      return await transaction(null as any);
    }

    this.log.debug(`Starting transaction on table ${this.tableName}`);
    return await this.db.transaction(transaction, config);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Start a SELECT query on the table.
   */
  protected rawSelect(opts: StatementOptions = {}) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    return db.select().from(this.table as PgTable);
  }

  /**
   * Start a SELECT DISTINCT query on the table.
   */
  protected rawSelectDistinct(
    opts: StatementOptions = {},
    columns: (keyof Static<T>)[] = [],
  ) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
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
  protected rawInsert(opts: StatementOptions = {}) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    return db.insert(this.table);
  }

  /**
   * Start an UPDATE query on the table.
   */
  protected rawUpdate(opts: StatementOptions = {}) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    return db.update(this.table);
  }

  /**
   * Start a DELETE query on the table.
   */
  protected rawDelete(opts: StatementOptions = {}) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    return db.delete(this.table);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Create a Drizzle `select` query based on a JSON query object.
   *
   * > This method is the base for `find`, `findOne`, `findById`, and `paginate`.
   */
  public async findMany<R extends PgRelationMap<T>>(
    query: PgQueryRelations<T, R> = {},
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R>[]> {
    // Check cache
    if (opts.cache) {
      const cacheKey = opts.cache.key ?? this.buildCacheKey("findMany", query);
      const cached = await this.dbCache.get<PgStatic<T, R>[]>(
        this.tableName,
        cacheKey,
      );
      if (cached) return cached;
    }

    await this.alepha.events.emit("repository:read:before", {
      tableName: this.tableName,
      query,
    });

    const columns = query.columns ?? query.distinct;
    const builder = query.distinct
      ? this.rawSelectDistinct(opts, query.distinct)
      : this.rawSelect(opts);

    const joins: Array<PgJoin> = [];
    if (query.with) {
      this.relationManager.buildJoins(
        this.provider,
        builder,
        joins,
        query.with,
        this.table,
      );
    }

    const where = this.withDeletedAt(
      (query.where ?? {}) as PgQueryWhere<T>,
      opts,
    );

    builder.where(() => this.toSQL(where, joins));

    if (query.offset) {
      builder.offset(query.offset);

      // SQLite requires LIMIT when OFFSET is used
      if (this.provider.dialect === "sqlite" && !query.limit) {
        query.limit = 1000;
      }
    }

    if (query.limit) {
      builder.limit(query.limit);
    }

    if (query.orderBy) {
      const orderByClauses = this.queryManager.normalizeOrderBy(query.orderBy);
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

      let schema: TObject = this.entity.schema;
      if (columns) {
        schema = t.pick(schema, columns);
      }

      if (joins.length) {
        rows = rows.map((row: any) => {
          // Clone schema for each row to avoid mutation
          const rowSchema = { ...schema, properties: { ...schema.properties } };
          return this.relationManager.mapRowWithJoins(
            row[this.tableName],
            row,
            rowSchema,
            joins,
          );
        });
      }

      rows = rows.map((row) => {
        // For joined queries, build a schema that includes all nested joins
        if (joins.length) {
          const joinedSchema = this.relationManager.buildSchemaWithJoins(
            schema,
            joins,
          );
          // Clean the row with the full joined schema (including nested relations)
          return this.cleanWithJoins(row, joinedSchema, joins);
        }
        return this.clean(row, schema);
      });

      await this.alepha.events.emit("repository:read:after", {
        tableName: this.tableName,
        query,
        entities: rows,
      });

      const result = rows as PgStatic<T, R>[];

      // Store in cache
      if (opts.cache) {
        const cacheKey =
          opts.cache.key ?? this.buildCacheKey("findMany", query);
        await this.dbCache.set(
          this.tableName,
          cacheKey,
          result,
          opts.cache.ttl,
        );
      }

      return result;
    } catch (error) {
      throw this.handleError(error, "Query select has failed");
    }
  }

  /**
   * Find a single entity. Returns `undefined` if not found.
   */
  public async findOne<R extends PgRelationMap<T>>(
    query: Pick<PgQueryRelations<T, R>, "with" | "where">,
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R> | undefined> {
    const [entity] = await this.findMany({ limit: 1, ...query }, opts);
    return entity as PgStatic<T, R> | undefined;
  }

  /**
   * Find a single entity. Throws `DbEntityNotFoundError` if not found.
   */
  public async getOne<R extends PgRelationMap<T>>(
    query: Pick<PgQueryRelations<T, R>, "with" | "where">,
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R>> {
    const entity = await this.findOne(query, opts);

    if (!entity) {
      throw new DbEntityNotFoundError(this.tableName);
    }

    return entity;
  }

  /**
   * Find entities with pagination.
   *
   * It uses the same parameters as `find()`, but adds pagination metadata to the response.
   *
   * > Pagination CAN also do a count query to get the total number of elements.
   */
  public async paginate<R extends PgRelationMap<T>>(
    pagination: PageQuery = {},
    query: Omit<PgQueryRelations<T, R>, "where"> & {
      where?: PgQueryWhere<T>;
    } = {},
    opts: StatementOptions & { count?: boolean } = {},
  ): Promise<Page<PgStatic<T, R>>> {
    const limit = query.limit ?? pagination.size ?? 10;
    const page = pagination.page ?? 0;
    const offset = query.offset ?? page * limit;

    let orderBy = query.orderBy;
    if (!query.orderBy && pagination.sort) {
      orderBy = this.queryManager.parsePaginationSort(pagination.sort) as any;
    }

    const now = Date.now();
    const timers = {
      query: now,
      count: now,
    };

    const tasks: Promise<any>[] = [];

    tasks.push(
      this.findMany(
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
      const countWhere = this.withDeletedAt(
        (query.where ?? {}) as PgQueryWhere<T>,
        opts,
      );

      tasks.push(
        this.db.$count(this.table, this.toSQL(countWhere)).then((it) => {
          timers.count = Date.now() - timers.count;
          return it;
        }),
      );
    }

    const [entities, countResult] = await Promise.all(tasks);

    // Normalize orderBy to get sort metadata
    let sortMetadata:
      | Array<{ column: string; direction: "asc" | "desc" }>
      | undefined;
    if (orderBy) {
      sortMetadata = this.queryManager.normalizeOrderBy(orderBy);
    }

    const response = this.queryManager.createPagination<T>(
      entities,
      limit,
      offset,
      sortMetadata,
    );

    response.page.totalElements = countResult;
    if (countResult != null) {
      response.page.totalPages = Math.ceil(countResult / limit);
    }

    return response as Page<PgStatic<T, R>>;
  }

  /**
   * Find an entity by ID. Returns `undefined` if not found.
   */
  public async findById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Static<T> | undefined> {
    return await this.findOne(
      {
        where: this.getWhereId(id),
      },
      opts,
    );
  }

  /**
   * Find an entity by ID. Throws `DbEntityNotFoundError` if not found.
   */
  public async getById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
    const entity = await this.findById(id, opts);

    if (!entity) {
      throw new DbEntityNotFoundError(this.tableName);
    }

    return entity;
  }

  /**
   * Helper to create a type-safe query object.
   */
  public createQuery(): PgQuery<T> {
    return {};
  }

  /**
   * Helper to create a type-safe where clause.
   */
  public createQueryWhere(): PgQueryWhere<T> {
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
    data: Static<TObjectInsert<T>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
    this.assertWritable();
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });

    try {
      const entity = await this.rawInsert(opts)
        .values(this.cast(data ?? {}, true))
        .returning(this.table)
        .then(([it]) => this.clean(it, this.entity.schema));

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data,
        entity,
      });

      return entity;
    } catch (error) {
      throw this.handleError(error, "Insert query has failed");
    }
  }

  /**
   * Create many entities.
   *
   * Inserts are batched in chunks of 1000 to avoid hitting database limits.
   *
   * @param values The entities to create.
   * @param opts The statement options.
   * @returns The created entities.
   */
  public async createMany(
    values: Array<Static<TObjectInsert<T>>>,
    opts: StatementOptions & { batchSize?: number } = {},
  ): Promise<Static<T>[]> {
    this.assertWritable();
    if (values.length === 0) {
      return [];
    }

    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data: values,
    });

    const batchSize = opts.batchSize ?? 1000;
    const allEntities: Static<T>[] = [];

    try {
      for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        const entities = await this.rawInsert(opts)
          .values(batch.map((data) => this.cast(data, true)))
          .returning(this.table)
          .then((rows) => rows.map((it) => this.clean(it, this.entity.schema)));
        allEntities.push(...entities);
      }

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data: values,
        entity: allEntities,
      });

      return allEntities;
    } catch (error) {
      throw this.handleError(error, "Insert query has failed");
    }
  }

  /**
   * Insert or update an entity.
   *
   * If a row with the same conflict target already exists, it updates that row.
   * Otherwise, it inserts a new row.
   *
   * @param data The entity data to insert.
   * @param opts.target The column(s) to detect conflicts on. Defaults to the primary key.
   * @param opts.set The fields to update on conflict. Defaults to the insert data (minus conflict target columns).
   * @returns The created or updated entity.
   *
   * @example
   * ```ts
   * // Simple upsert on primary key
   * await repo.upsert({ id: "abc", name: "Alice", role: "admin" });
   *
   * // Upsert on a unique column
   * await repo.upsert(
   *   { email: "alice@example.com", name: "Alice" },
   *   { target: ["email"] },
   * );
   *
   * // Upsert with custom update fields
   * await repo.upsert(
   *   { id: "abc", name: "Alice", role: "admin" },
   *   { set: { role: "admin" } },
   * );
   * ```
   */
  public async upsert(
    data: Static<TObjectInsert<T>>,
    opts: StatementOptions & {
      target?: Array<keyof Static<T>>;
      set?: WithSQL<Static<TObjectUpdate<T>>>;
    } = {},
  ): Promise<Static<T>> {
    this.assertWritable();
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });

    const targetKeys = opts.target ?? [this.id.key];
    const targetColumns = targetKeys.map((key) => this.col(key as string));

    let setData: any;
    if (opts.set) {
      setData = opts.set;
    } else {
      // Default: update all fields from the insert data except the conflict target and primary key columns
      setData = { ...data };
      for (const key of targetKeys) {
        delete setData[key];
      }
      delete setData[this.id.key];
    }

    // Always inject updatedAt into the conflict SET clause. This ensures that even
    // with `set: {}`, the ON CONFLICT path touches the row — making it possible to
    // distinguish inserts from no-ops by comparing createdAt vs updatedAt.
    const updatedAtField = getAttrFields(
      this.entity.schema,
      PG_UPDATED_AT,
    )?.[0];

    if (updatedAtField) {
      setData[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    //setData = this.cast(setData, false) as any;

    try {
      const entity = await this.rawInsert(opts)
        .values(this.cast(data ?? {}, true))
        .onConflictDoUpdate({
          target: targetColumns,
          set: setData,
        })
        .returning(this.table)
        .then(([it]) => this.clean(it, this.entity.schema));

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data,
        entity,
      });

      return entity;
    } catch (error) {
      throw this.handleError(error, "Upsert query has failed");
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find an entity and update it.
   */
  public async updateOne(
    where: PgQueryWhereOrSQL<T>,
    data: WithSQL<Static<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
    this.assertWritable();
    await this.alepha.events.emit("repository:update:before", {
      tableName: this.tableName,
      where,
      data,
    });

    let row = data as any;

    const updatedAtField = getAttrFields(
      this.entity.schema,
      PG_UPDATED_AT,
    )?.[0];

    if (updatedAtField) {
      row[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    where = this.withDeletedAt(where, opts);
    row = this.cast(row, false) as any;

    // do not update the ID field
    delete row[this.id.key];

    const response = await this.rawUpdate(opts)
      .set(row)
      .where(this.toSQL(where))
      .returning(this.table)
      .catch((error) => {
        throw this.handleError(error, "Update query has failed");
      });

    if (!response[0]) {
      throw new DbEntityNotFoundError(this.tableName);
    }

    try {
      const entity = this.clean(response[0], this.entity.schema);

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:update:after", {
        tableName: this.tableName,
        where,
        data,
        entities: [entity],
      });

      return entity;
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
   * @see {@link DbVersionMismatchError}
   */
  public async save(
    entity: Static<T>,
    opts: StatementOptions = {},
  ): Promise<void> {
    this.assertWritable();
    const row = entity as any;

    const id = row[this.id.key];
    if (id == null) {
      throw new AlephaError(
        "Cannot save entity without ID - missing primary key in value",
      );
    }

    // in save mode, we do not ignore undefined values, but set them to null
    for (const key of Object.keys(this.entity.schema.properties)) {
      if (row[key] === undefined) {
        row[key] = null;
      }
    }

    let where: any = this.createQueryWhere();

    where[this.id.key] = { eq: id };

    const versionField = getAttrFields(this.entity.schema, PG_VERSION)?.[0];
    if (versionField && typeof row[versionField.key] === "number") {
      where = {
        and: [
          where,
          {
            [versionField.key]: {
              eq: row[versionField.key],
            },
          },
        ],
      } as PgQueryWhere<T>;

      row[versionField.key] += 1;
    }

    try {
      const newValue = await this.updateOne(where, row, opts);
      for (const key of Object.keys(this.entity.schema.properties)) {
        row[key] = undefined;
      }
      Object.assign(row, newValue);
    } catch (error) {
      if (error instanceof DbEntityNotFoundError && versionField) {
        // Verify entity still exists to differentiate between not-found vs version mismatch
        try {
          // If getById succeeds, entity exists and this was a version mismatch
          await this.getById(id);
          throw new DbVersionMismatchError(this.tableName, id);
        } catch (lookupError) {
          // If it's still not found, propagate the original not found error
          if (lookupError instanceof DbEntityNotFoundError) {
            throw error; // Original error
          }
          // If it's a version mismatch error, propagate it
          if (lookupError instanceof DbVersionMismatchError) {
            throw lookupError;
          }
          // Other errors (network, timeout, etc.) should be re-thrown
          throw lookupError;
        }
      }
      throw error;
    }
  }

  /**
   * Find an entity by ID and update it.
   */
  public async updateById(
    id: string | number,
    data: WithSQL<Static<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
    return await this.updateOne(this.getWhereId(id), data, opts);
  }

  /**
   * Find many entities and update all of them.
   */
  public async updateMany(
    where: PgQueryWhereOrSQL<T>,
    data: WithSQL<Static<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    this.assertWritable();
    await this.alepha.events.emit("repository:update:before", {
      tableName: this.tableName,
      where,
      data,
    });

    const updatedAtField = getAttrFields(
      this.entity.schema,
      PG_UPDATED_AT,
    )?.[0];

    if (updatedAtField) {
      (data as any)[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    where = this.withDeletedAt(where, opts);
    data = this.cast(data, false) as any;
    try {
      const entities = await this.rawUpdate(opts)
        .set(
          data as PgUpdateSetSource<PgTableWithColumns<SchemaToTableConfig<T>>>,
        )
        .where(this.toSQL(where))
        .returning();

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:update:after", {
        tableName: this.tableName,
        where,
        data,
        entities,
      });

      return entities.map((it: any) => it[this.id.key]);
    } catch (error) {
      throw this.handleError(error, "Update query has failed");
    }
  }

  /**
   * Find many and delete all of them.
   * @returns Array of deleted entity IDs
   */
  public async deleteMany(
    where: PgQueryWhereOrSQL<T> = {},
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    this.assertWritable();
    const deletedAt = this.deletedAt();
    if (deletedAt && !opts.force) {
      return await this.updateMany(
        where,
        {
          [deletedAt.key]: opts.now ?? this.dateTimeProvider.nowISOString(),
        } as any,
        opts,
      );
    }

    await this.alepha.events.emit("repository:delete:before", {
      tableName: this.tableName,
      where,
    });

    try {
      const result = await this.rawDelete(opts)
        .where(this.toSQL(where))
        .returning({ id: (this.table as any)[this.id.key] });
      const ids = result.map((row) => row.id);

      this.dbCache.invalidateTable(this.tableName).catch(() => {});

      await this.alepha.events.emit("repository:delete:after", {
        tableName: this.tableName,
        where,
        ids,
      });

      return ids;
    } catch (error) {
      throw this.handleError(error, "Delete query has failed");
    }
  }

  /**
   * Delete all entities.
   * @returns Array of deleted entity IDs
   */
  public clear(opts: StatementOptions = {}): Promise<Array<number | string>> {
    return this.deleteMany({}, opts);
  }

  /**
   * Delete the given entity.
   *
   * You must fetch the entity first in order to delete it.
   * @returns Array containing the deleted entity ID
   */
  public async destroy(
    entity: Static<T>,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    const id = (entity as any)[this.id.key];
    if (id == null) {
      throw new AlephaError("Cannot destroy entity without ID");
    }

    const deletedAt = this.deletedAt();
    if (deletedAt && !opts.force) {
      opts.now ??= this.dateTimeProvider.nowISOString();
      (entity as any)[deletedAt.key] = opts.now;
    }

    return await this.deleteById(id, opts);
  }

  /**
   * Find an entity and delete it.
   * @returns Array of deleted entity IDs (should contain at most one ID)
   */
  public async deleteOne(
    where: PgQueryWhereOrSQL<T> = {},
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    const entity = await this.findOne({ where }, opts);
    if (!entity) {
      return [];
    }
    return await this.deleteMany(
      this.getWhereId((entity as any)[this.id.key]),
      opts,
    );
  }

  /**
   * Find an entity by ID and delete it.
   * @returns Array containing the deleted entity ID
   * @throws DbEntityNotFoundError if the entity is not found
   */
  public async deleteById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    const result = await this.deleteMany(this.getWhereId(id), opts);
    if (result.length === 0) {
      throw new DbEntityNotFoundError(
        `Entity with ID ${id} not found in ${this.tableName}`,
      );
    }
    return result;
  }

  /**
   * Count entities.
   */
  public async count(
    where: PgQueryWhereOrSQL<T> = {},
    opts: StatementOptions = {},
  ): Promise<number> {
    where = this.withDeletedAt(where, opts);
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    return db.$count(this.table, this.toSQL(where));
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Execute an aggregate query with type-safe select, groupBy, and having.
   *
   * @example
   * ```ts
   * const result = await repo.aggregate({
   *   select: { category: true, amount: { sum: true, avg: true } },
   *   groupBy: ["category"],
   *   having: { amount: { sum: { gt: 100 } } },
   *   orderBy: { column: "amount.sum", direction: "desc" },
   * });
   * // result: Array<{ category: string; amount: { sum: number; avg: number } }>
   * ```
   */
  public async aggregate<S extends AggregateSelect<T>>(
    query: AggregateQuery<T, S>,
    opts: StatementOptions = {},
  ): Promise<AggregateResult<T, S>[]> {
    const AGG_SEPARATOR = "___";

    // Build flat select fields
    const flatFields: Record<string, any> = {};
    const aggFn = (op: AggregateOp, column: any) => {
      switch (op) {
        case "count":
          return count(column);
        case "sum":
          return sum(column);
        case "avg":
          return avg(column);
        case "min":
          return min(column);
        case "max":
          return max(column);
      }
    };

    for (const [key, select] of Object.entries(query.select)) {
      if (select === true) {
        flatFields[key] = this.col(key);
      } else if (typeof select === "object" && select !== null) {
        for (const op of Object.keys(select) as AggregateOp[]) {
          if ((select as Record<string, boolean>)[op]) {
            flatFields[`${key}${AGG_SEPARATOR}${op}`] = aggFn(
              op,
              this.col(key),
            );
          }
        }
      }
    }

    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    let builder = db.select(flatFields).from(this.table as PgTable);

    // WHERE
    if (query.where) {
      const where = this.withDeletedAt(query.where as any, opts);
      builder = builder.where(this.toSQL(where)) as any;
    }

    // GROUP BY
    if (query.groupBy) {
      builder = builder.groupBy(
        ...query.groupBy.map((key) => this.col(key as string)),
      ) as any;
    }

    // HAVING
    if (query.having) {
      const havingConditions: SQL[] = [];
      for (const [key, ops] of Object.entries(query.having)) {
        if (!ops || typeof ops !== "object") continue;
        for (const [op, comparisons] of Object.entries(ops)) {
          if (!comparisons || typeof comparisons !== "object") continue;
          const aggExpr = aggFn(op as AggregateOp, this.col(key));
          for (const [cmp, val] of Object.entries(
            comparisons as Record<string, number>,
          )) {
            switch (cmp) {
              case "gt":
                havingConditions.push(gt(aggExpr, val));
                break;
              case "gte":
                havingConditions.push(gte(aggExpr, val));
                break;
              case "lt":
                havingConditions.push(lt(aggExpr, val));
                break;
              case "lte":
                havingConditions.push(lte(aggExpr, val));
                break;
              case "eq":
                havingConditions.push(drizzleEq(aggExpr, val));
                break;
              case "ne":
                havingConditions.push(ne(aggExpr, val));
                break;
            }
          }
        }
      }
      if (havingConditions.length > 0) {
        builder = builder.having(drizzleAnd(...havingConditions)!) as any;
      }
    }

    // ORDER BY
    if (query.orderBy) {
      const clauses = this.queryManager.normalizeOrderBy(query.orderBy);
      builder = builder.orderBy(
        ...clauses.map((clause) => {
          // Support dot notation: "amount.sum" → "amount___sum"
          const colName = clause.column.includes(".")
            ? clause.column.replace(".", AGG_SEPARATOR)
            : clause.column;
          const col = flatFields[colName];
          if (!col) {
            throw new AlephaError(
              `Invalid orderBy column '${clause.column}' in aggregate query`,
            );
          }
          return clause.direction === "desc" ? desc(col) : asc(col);
        }),
      ) as any;
    }

    // LIMIT / OFFSET
    if (query.limit) {
      builder = builder.limit(query.limit) as any;
    }
    if (query.offset) {
      builder = builder.offset(query.offset) as any;
    }

    try {
      const rows = await builder.execute();

      // Re-nest flat results: { amount___sum: 500 } → { amount: { sum: 500 } }
      return rows.map((row: any) => {
        const result: Record<string, any> = {};
        for (const [flatKey, value] of Object.entries(row)) {
          if (flatKey.includes(AGG_SEPARATOR)) {
            const [col, op] = flatKey.split(AGG_SEPARATOR);
            if (!result[col]) result[col] = {};
            result[col][op] = value != null ? Number(value) : 0;
          } else {
            result[flatKey] = value;
          }
        }
        return result as AggregateResult<T, S>;
      });
    } catch (error) {
      throw this.handleError(error, "Aggregate query has failed");
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Error message patterns for different database errors
  protected errorPatterns = {
    // Unique constraint violations
    conflict: [
      "duplicate key value violates unique constraint", // PostgreSQL
      "UNIQUE constraint failed", // SQLite
    ],
    // Foreign key violations
    foreignKey: [
      "violates foreign key constraint", // PostgreSQL
      "FOREIGN KEY constraint failed", // SQLite
    ],
    // NOT NULL violations
    notNull: [
      "violates not-null constraint", // PostgreSQL
      "NOT NULL constraint failed", // SQLite
    ],
    // Deadlock
    deadlock: [
      "deadlock detected", // PostgreSQL
      // SQLite doesn't have true deadlocks
    ],
    // Table not found
    tableNotFound: [
      "does not exist", // PostgreSQL: relation "x" does not exist
      "no such table", // SQLite
    ],
    // Column not found
    columnNotFound: [
      'column "', // PostgreSQL: column "x" does not exist
      "no such column", // SQLite
    ],
  };

  protected handleError(error: unknown, message: string): DbError {
    if (!(error instanceof Error)) {
      return new DbError(message);
    }

    const fullMessage =
      `${error.message} ${(error.cause as Error)?.message ?? ""}`.toLowerCase();

    const hasPattern = (patterns: string[]) =>
      patterns.some((pattern) => fullMessage.includes(pattern.toLowerCase()));

    const getSourceError = () =>
      error.cause instanceof Error ? error.cause : error;

    // Check for unique constraint violation (conflict)
    if (hasPattern(this.errorPatterns.conflict)) {
      return new DbConflictError(message, error);
    }

    // Check for foreign key violation
    if (hasPattern(this.errorPatterns.foreignKey)) {
      return DbForeignKeyError.fromDatabaseError(
        getSourceError(),
        this.tableName,
      );
    }

    // Check for NOT NULL violation
    if (hasPattern(this.errorPatterns.notNull)) {
      return DbNotNullError.fromDatabaseError(getSourceError(), this.tableName);
    }

    // Check for deadlock
    if (hasPattern(this.errorPatterns.deadlock)) {
      return DbDeadlockError.fromDatabaseError(getSourceError());
    }

    // Check for table not found (must check before column not found)
    if (
      hasPattern(this.errorPatterns.tableNotFound) &&
      (fullMessage.includes("relation") || fullMessage.includes("table"))
    ) {
      return DbTableNotFoundError.fromDatabaseError(getSourceError());
    }

    // Check for column not found
    if (hasPattern(this.errorPatterns.columnNotFound)) {
      return DbColumnNotFoundError.fromDatabaseError(getSourceError());
    }

    return new DbError(message, error);
  }

  protected withDeletedAt(
    where: PgQueryWhereOrSQL<T>,
    opts: {
      force?: boolean;
    } = {},
  ): PgQueryWhereOrSQL<T> {
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
    } as PgQueryWhereOrSQL<T>;
  }

  protected deletedAt(): PgAttrField | undefined {
    const deletedAtFields = getAttrFields(this.entity.schema, PG_DELETED_AT);
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
  ): PgInsertValue<PgTableWithColumns<SchemaToTableConfig<T>>> {
    const schema = insert
      ? this.entity.insertSchema // insert
      : (t.partial(this.entity.updateSchema) as TObject); // update

    return this.alepha.codec.encode(schema, data) as PgInsertValue<
      PgTableWithColumns<SchemaToTableConfig<T>>
    >;
  }

  /**
   * Transform a row from the database into a clean entity.
   */
  protected clean<T extends TObject>(
    row: Record<string, unknown>,
    schema: T,
  ): Static<T> {
    for (const key of Object.keys(schema.properties)) {
      const value = schema.properties[key];

      // convert PG date-time and date to ISO strings
      if (typeof row[key] === "string") {
        if (t.schema.isDateTime(value)) {
          row[key] = this.dateTimeProvider.of(row[key]).toISOString();
        } else if (t.schema.isDate(value)) {
          row[key] = this.dateTimeProvider
            .of(`${row[key]}T00:00:00Z`)
            .toISOString()
            .split("T")[0];
        }
      }

      // convert BigInt to string
      if (typeof row[key] === "bigint" && t.schema.isBigInt(value)) {
        row[key] = row[key].toString();
      }
    }

    return this.alepha.codec.decode(schema, row) as Static<T>;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // INTERNAL METHODS

  /**
   * Clean a row with joins recursively
   */
  protected cleanWithJoins<T extends TObject>(
    row: Record<string, unknown>,
    schema: T,
    joins: PgJoin[],
    parentPath?: string,
  ): Static<T> {
    // Get joins at this level
    const joinsAtThisLevel = joins.filter((j) => j.parent === parentPath);

    // Create a copy of the row for cleaning, removing joined data temporarily
    const cleanRow: Record<string, unknown> = { ...row };
    const joinedData: Record<string, unknown> = {};

    for (const join of joinsAtThisLevel) {
      joinedData[join.key] = cleanRow[join.key];
      delete cleanRow[join.key];
    }

    // Clean the base entity without joined properties
    const entity = this.clean(cleanRow, schema);

    // Then recursively clean joined entities
    for (const join of joinsAtThisLevel) {
      const joinedValue = joinedData[join.key];
      // Only process if the joined value exists
      if (joinedValue != null) {
        // Build path for this join
        const joinPath = parentPath ? `${parentPath}.${join.key}` : join.key;
        // Find child joins
        const childJoins = joins.filter((j) => j.parent === joinPath);
        // Recursively clean if there are child joins
        if (childJoins.length > 0) {
          (entity as any)[join.key] = this.cleanWithJoins(
            joinedValue as Record<string, unknown>,
            join.schema,
            joins,
            joinPath,
          );
        } else {
          // No child joins, just clean this join
          (entity as any)[join.key] = this.clean(
            joinedValue as Record<string, unknown>,
            join.schema,
          );
        }
      } else {
        // Set to undefined if no data
        (entity as any)[join.key] = undefined;
      }
    }

    return entity as Static<T>;
  }

  /**
   * Throw if this repository is read-only (backed by a view).
   */
  protected assertWritable(): void {
    if (this.isReadOnly) {
      throw new AlephaError(
        `Cannot write to view '${this.tableName}'. Views are read-only.`,
      );
    }
  }

  /**
   * Refresh a materialized view. PostgreSQL only.
   */
  public async refresh(): Promise<void> {
    if (!(this.entity as any).materialized) {
      throw new AlephaError(
        `Cannot refresh '${this.tableName}'. Only materialized views support refresh.`,
      );
    }
    await this.provider.execute(`REFRESH MATERIALIZED VIEW ${this.tableName}`);
  }

  /**
   * Build a cache key from method name and query parameters.
   */
  protected buildCacheKey(method: string, query: any): string {
    return `${method}:${JSON.stringify(query)}`;
  }

  /**
   * Convert a where clause to SQL.
   */
  protected toSQL(
    where: PgQueryWhereOrSQL<T>,
    joins?: PgJoin[],
  ): SQL | undefined {
    return this.queryManager.toSQL(where as PgQueryWhereOrSQL<T>, {
      schema: this.entity.schema,
      col: (name) => {
        return this.col(name);
      },
      joins,
      dialect: this.provider.dialect,
    });
  }

  /**
   * Get the where clause for an ID.
   *
   * @param id The ID to get the where clause for.
   * @returns The where clause for the ID.
   */
  protected getWhereId(id: string | number): PgQueryWhere<T> {
    return {
      [this.id.key]: {
        eq: t.schema.isString(this.id.type) ? String(id) : Number(id),
      },
    } as PgQueryWhere<T>;
  }

  /**
   * Find a primary key in the schema.
   */
  protected getPrimaryKey(schema: TObject) {
    const primaryKeys = getAttrFields(schema, PG_PRIMARY_KEY);
    if (primaryKeys.length === 0) {
      throw new AlephaError("Primary key not found in schema");
    }

    if (primaryKeys.length > 1) {
      throw new AlephaError(
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The options for a statement.
 */
export interface StatementOptions {
  /**
   * Transaction to use.
   *
   * - `undefined` — auto-detect from `alepha.store` (implicit transactional context)
   * - `PgTransaction` — use this specific transaction (explicit)
   * - `null` — force no transaction, bypass implicit context
   */
  tx?: PgTransaction<any, Record<string, any>> | null;

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
  now?: DateTime | string;

  /**
   * Cache configuration for query results.
   *
   * When set, results are stored in an in-memory cache keyed by query parameters.
   * Any write to this table automatically invalidates all cached queries.
   *
   * @example
   * ```ts
   * await repo.findMany(query, { cache: { ttl: 60_000 } });
   * ```
   */
  cache?: {
    /**
     * Time-to-live in milliseconds.
     */
    ttl?: number;
    /**
     * Custom cache key. If not provided, a key is derived from the query.
     */
    key?: string;
  };
}

type WithSQL<T> = {
  [P in keyof T]?: T[P] | SQL;
};
