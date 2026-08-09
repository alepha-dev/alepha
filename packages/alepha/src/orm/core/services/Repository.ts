import {
  $inject,
  Alepha,
  AlephaError,
  createPagination,
  type Infer,
  type Page,
  type PageQuery,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  currentTenantAtom,
  currentUserAtom,
  tenancyAtom,
} from "alepha/security";
import {
  asc,
  avg,
  count,
  desc,
  and as drizzleAnd,
  eq as drizzleEq,
  getTableColumns,
  gt,
  gte,
  isSQLWrapper,
  lt,
  lte,
  max,
  min,
  ne,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import type {
  LockConfig,
  LockStrength,
  PgAsyncDatabase,
  PgAsyncTransaction,
  PgColumn,
  PgInsertValue,
  PgTable,
  PgTableWithColumns,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import {
  PG_DELETED_AT,
  PG_ORGANIZATION,
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

export abstract class Repository<T extends ZObject> {
  public readonly entity: EntityPrimitive<T>;
  public readonly provider: DatabaseProvider;

  protected readonly log = $logger();
  protected readonly relationManager = $inject(PgRelationManager);
  protected readonly queryManager = $inject(QueryManager);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  // Injected, not `new`'d: bypassing DI made it impossible to substitute in
  // tests and gave every repository its own unbounded Map.
  protected readonly dbCache = $inject(DbCacheProvider);
  protected readonly alepha = $inject(Alepha);

  static of<T extends ZObject>(
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
    this.provider.registerEntity(entity as EntityPrimitive);
  }

  /**
   * Represents the primary key of the table.
   * - Key is the name of the primary key column.
   * - Type is the schema type of the primary key column.
   *
   * ID is mandatory. If the table does not have a primary key, it will throw an error.
   */
  public get id(): {
    type: ZType;
    key: keyof T["shape"];
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
   * Getter for the database connection from the database provider.
   *
   * Automatically picks up a transaction from `alepha.store` if one was set
   * by `DatabaseProvider.transactional()`, so that all repository operations
   * inside a `transactional()` block participate in the same transaction.
   */
  protected get db(): PgAsyncDatabase<any> {
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
   *   repository = $repository(userEntity);
   *   async getAdults() {
   *     const users = repository.table; // Drizzle table object
   *     await repository.query(sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`);
   *     // or better
   *     await repository.query((users) => sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`);
   *   }
   * }
   * ```
   */
  public async query<R extends ZObject = T>(
    query:
      | SQLLike
      | ((
          table: PgTableWithColumns<SchemaToTableConfig<T>>,
          db: PgAsyncDatabase<any>,
        ) => SQLLike),
    schema?: R,
  ): Promise<Infer<R>[]> {
    const raw =
      typeof query === "function" ? query(this.table, this.db) : query;

    if (typeof raw === "string" && raw.includes("[object Object]")) {
      throw new AlephaError(
        "Invalid SQL query. Did you forget to call the 'sql' function?",
      );
    }

    // Only wrap database execution errors, not post-processing errors (e.g., SchemaValidationError)
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
      ) as Infer<R>;
    });
  }

  protected columnNameMap?: Map<string, string>;

  /**
   * Map raw database fields to entity fields. (handles column name differences)
   */
  protected mapRawFieldsToEntity(row: Record<string, unknown>) {
    if (!this.columnNameMap) {
      this.columnNameMap = new Map();
      for (const colKey of Object.keys(this.table)) {
        this.columnNameMap.set(this.table[colKey].name, colKey);
      }
    }

    const entity: any = {};

    for (const key of Object.keys(row)) {
      entity[key] = row[key];
      const fieldKey = this.columnNameMap.get(key);
      if (fieldKey) {
        entity[fieldKey] = row[key];
      }
    }

    return entity;
  }

  /**
   * Get a Drizzle column from the table by his name.
   */
  protected col(name: keyof Infer<T>): PgColumn {
    const column = (this.table as any)[name];
    if (!column) {
      throw new AlephaError(
        `Invalid access. Column '${String(name)}' not found in table '${this.tableName}'`,
      );
    }

    return column;
  }

  /**
   * True when every column of `this.table` is excluded from INSERT column
   * lists — i.e. an identity ("always") or generated-always column, the
   * only shape drizzle-orm allows to make a column non-insertable.
   *
   * Mirrors drizzle-orm's internal `Column.shouldDisableInsert()` (not part
   * of its public API — this reads the same information from the public
   * `generated` / `generatedIdentity` getters instead of calling it).
   *
   * drizzle-orm 1.0.0-rc.4's postgres dialect has no special case for a row
   * with zero insertable columns: `db.insert(table).values({})` still
   * builds `insert into "table" () values ()`, which both Postgres and
   * SQLite reject as a syntax error. Verified with a minimal drizzle-orm +
   * postgres-js reproduction outside Alepha — this is upstream, not
   * something introduced by Repository's insert building.
   */
  protected hasNoInsertableColumns(): boolean {
    const columns = Object.values(getTableColumns(this.table as PgTable));
    return (
      columns.length > 0 &&
      columns.every(
        (column) =>
          (column.generated !== undefined &&
            column.generated.type !== "byDefault") ||
          (column.generatedIdentity !== undefined &&
            column.generatedIdentity.type !== "byDefault"),
      )
    );
  }

  /**
   * Fallback for `create()` against a table with zero insertable columns
   * (see {@link hasNoInsertableColumns}): `INSERT ... DEFAULT VALUES` is
   * the SQL form Postgres requires for that case.
   *
   * Postgres-only. `this.db`'s static type is `PgAsyncDatabase<any>`, but
   * every sqlite provider actually hands back a `SQLiteAsyncDatabase` cast
   * to that type (see e.g. `NodeSqliteProvider.db`) — the cast hides it
   * from the type checker, but `SQLiteAsyncDatabase` has no `.execute()`
   * (its API is `all/delete/get/insert/run/select/selectDistinct/
   * transaction/update/values/with`), so calling it here would throw
   * `TypeError: db.execute is not a function` at runtime.
   *
   * Reachable only for a sqlite entity whose *every* column is declared
   * `generatedAlwaysAs` — `SqliteModelBuilder` maps identity/autoincrement
   * primary keys to `.primaryKey({ autoIncrement: true })`, which sets
   * neither `generated` nor `generatedIdentity`, so a plain identity-only
   * sqlite entity never reaches `hasNoInsertableColumns() === true` in the
   * first place. Narrow enough that an explicit, honest error is preferable
   * to either a latent crash or new tx-aware plumbing for a path with no
   * current caller.
   *
   * The raw `db.execute()` used for Postgres bypasses drizzle's per-column
   * `returning()` decode (e.g. a bigint identity column arrives as the raw
   * driver string, not the JS number the entity schema expects). Rather
   * than reimplement that decode pipeline, this re-reads the row through
   * `getById()` — the same structured, decode-aware path a normal insert's
   * `.returning(this.table)` uses — keyed by the raw primary key value the
   * insert returned.
   */
  protected async insertDefaultValues(
    opts: StatementOptions,
  ): Promise<Infer<T>> {
    if (this.provider.dialect !== "postgresql") {
      throw new AlephaError(
        `create() against '${this.tableName}' has nothing to insert (every column is generated), and this fallback is only implemented for the 'postgresql' dialect. Add at least one non-generated column, or ask for '${this.provider.dialect}' support to be added.`,
      );
    }

    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    const pkColumn = this.id.col;
    const [row] = await db.execute<Record<string, unknown>>(
      sql`insert into ${this.table} default values returning ${pkColumn}`,
    );
    const pkValue = row[pkColumn.name] as string | number;
    return this.getById(pkValue, opts);
  }

  /**
   * Run a transaction.
   */
  public async transaction<T>(
    transaction: (
      tx: PgAsyncTransaction<any, Record<string, any>>,
    ) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T> {
    if (!this.provider.supportsTransactions) {
      throw new AlephaError(
        `Transactions are not supported with ${this.provider.driver} driver. Use $transactional() middleware instead, which gracefully degrades on unsupported drivers.`,
      );
    }

    this.log.debug(`Starting transaction on table ${this.tableName}`);

    if (this.provider.usesSyncTransactions) {
      // Drizzle's sync SQLite session commits as soon as the callback
      // returns — an async callback would run its awaited statements OUTSIDE
      // the transaction and rollback could never happen. Route through the
      // provider's awaited implementation instead; statements participate via
      // the shared connection, so the db itself acts as the tx handle.
      return this.provider.transactional(() =>
        transaction(
          this.db as unknown as PgAsyncTransaction<any, Record<string, any>>,
        ),
      );
    }

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
  /**
   * SELECT of only the requested columns. The primary key is always included
   * so downstream mapping and caching keep working.
   */
  protected rawSelectColumns(
    opts: StatementOptions = {},
    columns: (keyof Infer<T>)[] = [],
  ) {
    const db = opts.tx === null ? this.provider.db : (opts.tx ?? this.db);
    const table = this.table as PgTable;

    const fields: Record<string, any> = {};
    for (const column of [this.id.key, ...columns]) {
      if (typeof column === "string" && !fields[column]) {
        fields[column] = this.col(column);
      }
    }

    return db.select(fields).from(table);
  }

  protected rawSelectDistinct(
    opts: StatementOptions = {},
    columns: (keyof Infer<T>)[] = [],
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
   * > This method is the base for `findOne`, `findById`, and `paginate`.
   */
  public async findMany<R extends PgRelationMap<T>>(
    query: PgQueryRelations<T, R> = {},
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R>[]> {
    // Check cache
    if (opts.cache) {
      const cacheKey =
        opts.cache.key ?? this.buildCacheKey("findMany", query, opts);
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

    if (query.distinct && query.with) {
      // `rawSelectDistinct` selects a FLAT field map, while the join
      // post-processing below expects drizzle's nested per-table row shape —
      // `row[this.tableName]` is undefined and the mapping quietly produces
      // junk. Refuse rather than return garbage.
      throw new AlephaError(
        `Query on '${this.tableName}' combines 'distinct' with 'with' (joins), which is not supported: ` +
          "SELECT DISTINCT returns a flat row that the join mapper cannot reassemble. " +
          "Drop one of the two, or de-duplicate after the join.",
      );
    }

    const columns = query.columns ?? query.distinct;
    const builder = query.distinct
      ? this.rawSelectDistinct(opts, query.distinct)
      : // Narrow the SQL projection too, not just the schema `clean()` uses.
        // `columns` only affected the returned shape, so a wide table still
        // paid full row I/O for a two-column read. Joins keep SELECT * — the
        // join mapper needs every table's columns to reassemble the row.
        query.columns && !query.with
        ? this.rawSelectColumns(opts, query.columns)
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

    const where = this.withOrganization(
      this.withDeletedAt((query.where ?? {}) as PgQueryWhere<T>, opts),
    );

    builder.where(() => this.toSQL(where, joins));

    let limit = query.limit;
    if (query.offset) {
      builder.offset(query.offset);

      // SQLite requires LIMIT when OFFSET is used. Use an effectively
      // unbounded limit so the dialects stay equivalent (a fixed cap would
      // silently truncate), without mutating the caller's query object.
      if (this.provider.dialect === "sqlite" && !limit) {
        limit = Number.MAX_SAFE_INTEGER;
      }
    }

    if (limit) {
      builder.limit(limit);
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

      let schema: ZObject = this.entity.schema;
      if (columns) {
        schema = schema.pick(
          Object.fromEntries(columns.map((c) => [c, true])) as never,
        ) as ZObject;
      }

      // Build joinedSchema once per query (not per row) to avoid SchemaValidator
      // cache growth — each buildSchemaWithJoins() produces a fresh schema object.
      const joinedSchema = joins.length
        ? this.relationManager.buildSchemaWithJoins(schema, joins)
        : null;

      if (joins.length) {
        rows = rows.map((row: any) =>
          this.relationManager.mapRowWithJoins(
            row[this.tableName],
            row,
            schema,
            joins,
          ),
        );
      }

      rows = rows.map((row) => {
        if (joinedSchema) {
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
          opts.cache.key ?? this.buildCacheKey("findMany", query, opts);
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
   * It uses the same parameters as `findMany()`, but adds pagination metadata to the response.
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
    // Overflow-safe: pageQuerySchema constrains size to [1, 100] and page to >= 0.
    // With max size=100, page would need to exceed 2^45 to overflow Number.MAX_SAFE_INTEGER.
    const limit = query.limit ?? pagination.size ?? 10;
    const page = pagination.page ?? 0;
    const offset = query.offset ?? page * limit;

    let orderBy = query.orderBy;
    if (!query.orderBy && pagination.sort) {
      orderBy = this.queryManager.parsePaginationSort(pagination.sort) as any;
    }

    const now = this.dateTimeProvider.nowMillis();
    const timers = {
      query: now,
      count: now,
    };

    const tasks: Promise<any>[] = [];

    tasks.push(
      this.findMany(
        {
          ...query,
          offset,
          // one extra row is the next-page sentinel `createPagination` looks for
          limit: limit + 1,
          orderBy,
        },
        opts,
      ).then((it) => {
        timers.query = this.dateTimeProvider.nowMillis() - timers.query;
        return it;
      }),
    );

    if (opts.count) {
      const countWhere = this.withOrganization(
        this.withDeletedAt((query.where ?? {}) as PgQueryWhere<T>, opts),
      );

      tasks.push(
        // Same db resolution as `count()`: `this.db` ignored an explicit
        // `opts.tx`, so `paginate(..., { count: true, tx })` ran its count
        // OUTSIDE the transaction — reading rows the transaction had not
        // committed, or missing rows it had written.
        (opts.tx === null ? this.provider.db : (opts.tx ?? this.db))
          .$count(this.table, this.toSQL(countWhere))
          .then((it: number) => {
            timers.count = this.dateTimeProvider.nowMillis() - timers.count;
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

    const response = createPagination<T>(entities, limit, offset, sortMetadata);

    response.page.totalElements = countResult;
    if (countResult != null) {
      response.page.totalPages = Math.ceil(countResult / limit);
    }

    return response as Page<PgStatic<T, R>>;
  }

  /**
   * Find an entity by ID. Returns `undefined` if not found.
   *
   * Pass `with` to eager-load relations on the result — same `with` map
   * shape as `findOne` / `paginate`. Without `with`, returns the plain
   * row.
   *
   * @example
   * ```ts
   * const session = await sessions.findById(id, {
   *   with: { user: { join: users, on: ["userId", users.cols.id] as const } },
   * });
   * session?.user?.email;
   * ```
   */
  public async findById<R extends PgRelationMap<T>>(
    id: string | number,
    opts: StatementOptions & { with?: R } = {},
  ): Promise<PgStatic<T, R> | undefined> {
    const { with: withRelations, ...rest } = opts;
    return (await this.findOne<R>(
      {
        where: this.getWhereId(id),
        ...(withRelations ? { with: withRelations } : {}),
      } as Pick<PgQueryRelations<T, R>, "with" | "where">,
      rest,
    )) as PgStatic<T, R> | undefined;
  }

  /**
   * Find an entity by ID. Throws `DbEntityNotFoundError` if not found.
   *
   * Pass `with` to eager-load relations — see {@link findById}.
   */
  public async getById<R extends PgRelationMap<T>>(
    id: string | number,
    opts: StatementOptions & { with?: R } = {},
  ): Promise<PgStatic<T, R>> {
    const entity = await this.findById<R>(id, opts);

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
   * @returns The created entity.
   */
  public async create(
    data: Infer<TObjectInsert<T>>,
    opts: StatementOptions = {},
  ): Promise<Infer<T>> {
    this.stampOrganization(data);
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });

    try {
      // A table whose only column(s) are identity/generated-always has
      // nothing for `.values()` to insert — see `hasNoInsertableColumns`.
      const entity = this.hasNoInsertableColumns()
        ? await this.insertDefaultValues(opts)
        : await this.rawInsert(opts)
            .values(this.cast(data ?? {}, true))
            .returning(this.table)
            .then(([it]) => this.clean(it, this.entity.schema));

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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
   * **Order is guaranteed**: the returned array is index-aligned with
   * `values`, across batch boundaries. Callers rely on this to map
   * generated ids back onto their source rows — a data importer, for
   * example, rebuilds its old-id → new-id table by zipping the two
   * arrays, and silently corrupts every foreign key if the order drifts.
   * Batching changes must preserve it; `createMany preserves input order`
   * in the repository tests pins it.
   *
   * @param values The entities to create.
   * @param opts The statement options.
   * @returns The created entities, in the same order as `values`.
   */
  public async createMany(
    values: Array<Infer<TObjectInsert<T>>>,
    opts: StatementOptions & { batchSize?: number } = {},
  ): Promise<Infer<T>[]> {
    if (values.length === 0) {
      return [];
    }

    for (const value of values) {
      this.stampOrganization(value);
    }

    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data: values,
    });

    // Batches are NOT one atomic unit unless the caller wraps the call in
    // `$transactional`: a failure in batch N leaves batches 1..N-1 committed.
    // Documented rather than silently wrapped, because an implicit
    // transaction around an arbitrarily large insert is its own hazard (lock
    // duration, WAL growth) and the caller is better placed to decide.
    const batchSize = opts.batchSize ?? 1000;
    const allEntities: Infer<T>[] = [];

    try {
      for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        const entities = await this.rawInsert(opts)
          .values(batch.map((data) => this.cast(data, true)))
          .returning(this.table)
          .then((rows) => rows.map((it) => this.clean(it, this.entity.schema)));
        allEntities.push(...entities);
      }

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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
    data: Infer<TObjectInsert<T>>,
    opts: StatementOptions & {
      target?: Array<keyof Infer<T>>;
      set?: WithSQL<Infer<TObjectUpdate<T>>>;
    } = {},
  ): Promise<Infer<T>> {
    this.stampOrganization(data);
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });

    const targetKeys = opts.target ?? [this.id.key];
    const targetColumns = targetKeys.map((key) => this.col(key as string));

    let setData: any;
    if (opts.set) {
      // Copy, never stamp in place: `updatedAt` is injected below, and writing
      // it into the caller's `set` object leaves them holding a clause that
      // gained a column they never wrote. The `else` branch already copies.
      setData = { ...(opts.set as Record<string, unknown>) };
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

    // With no `updatedAt` column and nothing left after removing the conflict
    // target and the PK, the SET clause is empty and drizzle rejects the
    // statement ("No values to set"). Setting the target to itself is a no-op
    // UPDATE that keeps ON CONFLICT DO UPDATE valid — and, unlike DO NOTHING,
    // still RETURNs the conflicting row, which the caller expects.
    if (Object.keys(setData).length === 0) {
      const source = (data ?? {}) as Record<string, unknown>;
      for (const key of targetKeys) {
        setData[key as string] = source[key as string];
      }
    }

    // The ON CONFLICT payload goes through the same validation and codec
    // encoding as every other write path. Skipping it let a value of the wrong
    // type reach the driver — and sqlite, being dynamically typed, stored it,
    // so the row could only be read back as a validation error afterwards.
    // `cast` lifts raw SQL expressions out before validating and re-attaches
    // them, so `set: { hits: sql\`hits + 1\` }` still works.
    setData = this.cast(setData, false) as any;

    // Scope the conflict-UPDATE to the current tenant and non-deleted rows so a
    // conflict on a tenant-agnostic unique key (e.g. `email`) cannot silently
    // overwrite — or resurrect — another organization's row. Only entities that
    // are actually org- or soft-delete-scoped pay for this; plain entities keep
    // the original statement byte-for-byte.
    const setWhere =
      this.organizationField() || this.deletedAt()
        ? this.toSQL(
            this.withOrganization(
              this.withDeletedAt({} as PgQueryWhere<T>, opts),
            ),
          )
        : undefined;

    try {
      const entity = await this.rawInsert(opts)
        .values(this.cast(data ?? {}, true))
        .onConflictDoUpdate({
          target: targetColumns,
          set: setData,
          ...(setWhere ? { setWhere } : {}),
        })
        .returning(this.table)
        .then(([it]) => {
          if (!it) {
            // The conflicting row is outside the current tenant/soft-delete
            // scope, so the guarded UPDATE matched nothing and no row was
            // inserted. Fail loudly rather than cleaning `undefined`.
            throw new AlephaError(
              `Upsert on '${this.tableName}' conflicted with a row outside the current tenant (or an already-deleted row); refusing to overwrite it.`,
            );
          }
          return this.clean(it, this.entity.schema);
        });

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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

  /**
   * Insert or update many entities in ONE statement.
   *
   * The reason to reach for this over a loop of {@link upsert} is round-trips:
   * against a remote database (D1 in particular) a batch of twenty becomes one
   * network call instead of twenty, which is usually the whole cost.
   *
   * ⚠️ **Two rules the single-row version does not have.**
   *
   * 1. **No duplicate conflict targets within one call.** The engines disagree,
   *    which is worse than either behaviour alone: Postgres refuses outright
   *    ("ON CONFLICT DO UPDATE command cannot affect row a second time"), and
   *    SQLite quietly applies them one after another. Code written and tested
   *    against SQLite therefore passes locally and throws in Postgres. Fold
   *    duplicates before calling.
   * 2. **Counter updates must read `excluded`.** `set: { hits: sql`hits + 1` }`
   *    is correct for one row and wrong for a batch: it adds one no matter how
   *    many the batch carried. Use the incoming value instead, via the
   *    `excluded` pseudo-table both engines expose:
   *    `set: { hits: sql`${t.hits} + excluded.hits` }`.
   *
   * @param values The rows to insert. Empty array is a no-op.
   * @param opts.target The column(s) to detect conflicts on. Defaults to the primary key.
   * @param opts.set The fields to update on conflict. Defaults to each row's own insert data (minus conflict target columns) — note that with a shared `set` this is one clause for every row, which is why counters have to go through `excluded`.
   * @returns The created or updated entities.
   *
   * @example
   * ```ts
   * // Accumulate page-view counters in one round-trip.
   * await repo.upsertMany(
   *   [
   *     { path: "/", hour, count: 4 },
   *     { path: "/about", hour, count: 1 },
   *   ],
   *   {
   *     target: ["path", "hour"],
   *     set: { count: sql`${repo.table.count} + excluded.count` },
   *   },
   * );
   * ```
   */
  public async upsertMany(
    values: Array<Infer<TObjectInsert<T>>>,
    opts: StatementOptions & {
      target?: Array<keyof Infer<T>>;
      set?: WithSQL<Infer<TObjectUpdate<T>>>;
    } = {},
  ): Promise<Infer<T>[]> {
    if (values.length === 0) {
      return [];
    }

    for (const value of values) {
      this.stampOrganization(value);
    }

    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data: values,
    });

    const targetKeys = opts.target ?? [this.id.key];
    const targetColumns = targetKeys.map((key) => this.col(key as string));

    let setData: any;
    if (opts.set) {
      // Copy rather than stamp in place — same reasoning as `upsert`.
      setData = { ...(opts.set as Record<string, unknown>) };
    } else {
      // Without an explicit clause there is no per-row `set` to build: one
      // statement carries exactly one `DO UPDATE`. Fall back to `excluded`, so
      // each conflicting row is updated from the values it arrived with rather
      // than from whichever row of the batch happened to be first.
      setData = {};
      const sample = values[0] as Record<string, unknown>;
      for (const key of Object.keys(sample)) {
        if (targetKeys.includes(key as keyof Infer<T>)) continue;
        if (key === this.id.key) continue;
        setData[key] = sql.raw(`excluded.${this.col(key).name}`);
      }
    }

    const updatedAtField = getAttrFields(
      this.entity.schema,
      PG_UPDATED_AT,
    )?.[0];

    if (updatedAtField) {
      setData[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    // Same empty-SET guard as `upsert`: drizzle rejects a `DO UPDATE` with
    // nothing to set, and `DO NOTHING` would not return the conflicting rows.
    if (Object.keys(setData).length === 0) {
      for (const key of targetKeys) {
        setData[key as string] = sql.raw(
          `excluded.${this.col(key as string).name}`,
        );
      }
    }

    setData = this.cast(setData, false) as any;

    const setWhere =
      this.organizationField() || this.deletedAt()
        ? this.toSQL(
            this.withOrganization(
              this.withDeletedAt({} as PgQueryWhere<T>, opts),
            ),
          )
        : undefined;

    try {
      const rows = await this.rawInsert(opts)
        .values(values.map((value) => this.cast(value ?? {}, true)))
        .onConflictDoUpdate({
          target: targetColumns,
          set: setData,
          ...(setWhere ? { setWhere } : {}),
        })
        .returning(this.table);

      const entities = rows.map((row: any) =>
        this.clean(row, this.entity.schema),
      );

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data: values,
        entity: entities,
      });

      return entities;
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
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Infer<T>> {
    await this.alepha.events.emit("repository:update:before", {
      tableName: this.tableName,
      where,
      data,
    });

    const updatedAtField = getAttrFields(
      this.entity.schema,
      PG_UPDATED_AT,
    )?.[0];

    // Shallow-copy before stamping, same as `updateMany`: writing `updatedAt`
    // into the caller's object hands back a patch carrying a column it never
    // declared — which bites when the patch is a shared constant, is reused
    // across calls, or is validated/audited by the caller afterwards.
    let row: any = { ...(data as Record<string, unknown>) };

    if (updatedAtField) {
      row[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    where = this.withOrganization(this.withDeletedAt(where, opts));
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

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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
   * - check db.version() if present -> optimistic locking
   * - validate entity against schema
   * - undefined values will be set to null, not ignored!
   *
   * @see {@link DbVersionMismatchError}
   */
  public async save(
    entity: Infer<T>,
    opts: StatementOptions = {},
  ): Promise<void> {
    const row = entity as any;

    const id = row[this.id.key];
    if (id == null) {
      throw new AlephaError(
        "Cannot save entity without ID - missing primary key in value",
      );
    }

    // in save mode, we do not ignore undefined values, but set them to null
    for (const key of Object.keys(z.schema.shape(this.entity.schema))) {
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
      for (const key of Object.keys(z.schema.shape(this.entity.schema))) {
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
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Infer<T>> {
    return await this.updateOne(this.getWhereId(id), data, opts);
  }

  /**
   * Find many entities and update all of them.
   */
  public async updateMany(
    where: PgQueryWhereOrSQL<T>,
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
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
      // Shallow-copy before stamping: writing into the caller's object means a
      // reused patch carries a stale `updatedAt` into the next call.
      data = {
        ...(data as Record<string, unknown>),
        [updatedAtField.key]: opts.now ?? this.dateTimeProvider.nowISOString(),
      } as typeof data;
    }

    where = this.withOrganization(this.withDeletedAt(where, opts));
    data = this.cast(data, false) as any;
    try {
      const entities = await this.rawUpdate(opts)
        .set(
          data as PgUpdateSetSource<PgTableWithColumns<SchemaToTableConfig<T>>>,
        )
        .where(this.toSQL(where))
        .returning();

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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

    where = this.withOrganization(where);

    await this.alepha.events.emit("repository:delete:before", {
      tableName: this.tableName,
      where,
    });

    try {
      const result = await this.rawDelete(opts)
        .where(this.toSQL(where))
        .returning({ id: (this.table as any)[this.id.key] });
      const ids = result.map((row) => row.id);

      this.dbCache
        .invalidateTable(this.tableName)
        .catch((err) => this.log.warn("Cache invalidation failed", err));

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
    entity: Infer<T>,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    const id = (entity as any)[this.id.key];
    if (id == null) {
      throw new AlephaError("Cannot destroy entity without ID");
    }

    const deletedAt = this.deletedAt();
    if (deletedAt && !opts.force) {
      // Stamping the caller's ENTITY is DELIBERATE, not a stray mutation: it
      // keeps the in-memory object consistent with the row, so a later
      // `save(entity, { force: true })` writes the soft-delete back instead of
      // nulling it and resurrecting the row (`save` nulls undefined fields).
      // `testNoUpdateIfAlreadyDeleted` depends on exactly this.
      //
      // The caller's OPTIONS object is a different matter — it belongs to them,
      // and a reused `StatementOptions` that silently acquired a `now` would
      // pin every later statement to this instant. Resolve into a local copy.
      const now = opts.now ?? this.dateTimeProvider.nowISOString();
      (entity as any)[deletedAt.key] = now;
      return await this.deleteById(id, { ...opts, now });
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
    where = this.withOrganization(this.withDeletedAt(where, opts));
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

    // WHERE — tenant scoping and the soft-delete filter apply even when the
    // caller passes no `where` (like every other read path).
    const where = this.withOrganization(
      this.withDeletedAt((query.where ?? {}) as any, opts),
    );
    const whereSql = this.toSQL(where);
    if (whereSql) {
      builder = builder.where(whereSql) as any;
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

  /**
   * Classify a driver error the way this repository's own statements do.
   *
   * Public for the same reason as {@link Repository.readWhere}: a relational
   * read is issued elsewhere, and a caller catching `DbTableNotFoundError`
   * from `findMany` should not get a raw driver error back the moment they add
   * an `include`.
   */
  public wrapError(error: unknown, message: string): DbError {
    return this.handleError(error, message);
  }

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

    // Column before table: on a write, postgres reports a missing column as
    // `column "x" of relation "y" does not exist`, which contains both "does
    // not exist" and "relation" and so matched the table branch — the one
    // message that names the column was reported as a missing table. No
    // table-not-found message mentions a column, so this order is safe.
    if (hasPattern(this.errorPatterns.columnNotFound)) {
      return DbColumnNotFoundError.fromDatabaseError(getSourceError());
    }

    // Check for table not found
    if (
      hasPattern(this.errorPatterns.tableNotFound) &&
      (fullMessage.includes("relation") || fullMessage.includes("table"))
    ) {
      return DbTableNotFoundError.fromDatabaseError(getSourceError());
    }

    return new DbError(message, error);
  }

  /**
   * The predicate this repository adds to every read, on top of the caller's.
   *
   * Public because some relational reads do not pass through `findMany` at
   * all: the relational query builder issues one statement for a whole tree.
   * Sharing the predicate rather than reproducing it is what keeps soft delete
   * and tenancy true of those statements too — including the strict-tenancy
   * refusal, which throws here exactly as it would on a direct read.
   */
  public readWhere(
    where: unknown = {},
    opts: { force?: boolean } = {},
  ): unknown {
    return this.withOrganization(
      this.withDeletedAt((where ?? {}) as PgQueryWhereOrSQL<T>, opts),
    );
  }

  /**
   * Validate and decode a row this repository did not fetch itself.
   *
   * `columns` narrows the schema the way a projection does. `keep` names
   * properties to carry across untouched, which is how relation fields
   * survive: they belong to another entity's schema and would otherwise be
   * rejected as unknown.
   */
  public cleanRow(
    row: Record<string, unknown>,
    options: {
      columns?: ReadonlyArray<string>;
      keep?: ReadonlyArray<string>;
    } = {},
  ): Record<string, unknown> {
    const carried: Record<string, unknown> = {};
    const columnsOnly: Record<string, unknown> = { ...row };

    for (const key of options.keep ?? []) {
      if (key in columnsOnly) {
        carried[key] = columnsOnly[key];
        delete columnsOnly[key];
      }
    }

    let schema: ZObject = this.entity.schema;
    if (options.columns) {
      schema = schema.pick(
        Object.fromEntries(options.columns.map((c) => [c, true])) as never,
      ) as ZObject;
    }

    return {
      ...(this.clean(columnsOnly, schema) as Record<string, unknown>),
      ...carried,
    };
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
   * Whether this entity fails closed when no tenant resolves.
   *
   * The entity's own `strict` wins in both directions when it was set at all;
   * otherwise the application's {@link tenancyAtom} decides. That third state
   * is the whole design: framework entities say nothing, so the app — which
   * is the only place that knows whether it serves one tenant or many —
   * answers for them.
   */
  protected isStrictTenancy(orgField: PgAttrField): boolean {
    const declared = orgField.data?.strict;
    if (typeof declared === "boolean") {
      return declared;
    }
    return this.alepha.store.get(tenancyAtom).mode === "multi";
  }

  protected withOrganization(
    where: PgQueryWhereOrSQL<T>,
  ): PgQueryWhereOrSQL<T> {
    const orgField = this.organizationField();
    if (!orgField) {
      return where;
    }

    const strict = this.isStrictTenancy(orgField);
    const value = this.resolveOrganizationValue();
    if (!value) {
      if (strict) {
        // Fail closed: refuse rather than fall through to an unfiltered query
        // that would expose every tenant's rows on a sensitive table.
        throw new AlephaError(
          `Refusing to query tenant-scoped entity '${this.tableName}' with no resolved tenant/organization in context (strict tenancy).`,
        );
      }
      return where;
    }

    return {
      and: [
        where,
        // Strict entities drop the `OR org IS NULL` escape so a scoped tenant
        // never sees global/NULL rows.
        strict
          ? ({ [orgField.key]: { eq: value } } as any)
          : ({
              or: [
                { [orgField.key]: { eq: value } },
                { [orgField.key]: { isNull: true } },
              ],
            } as any),
      ],
    } as PgQueryWhereOrSQL<T>;
  }

  protected stampOrganization(data: any): void {
    const orgField = this.organizationField();
    if (!orgField) {
      return;
    }

    // An explicit value — including an explicit `null` "global row" — is a
    // deliberate, auditable choice and is honored as-is. Strict only guards
    // the fail-open accident: the org column simply omitted.
    if (orgField.key in data && data[orgField.key] !== undefined) {
      return;
    }

    const value = this.resolveOrganizationValue();
    if (value) {
      data[orgField.key] = value;
      return;
    }

    if (this.isStrictTenancy(orgField)) {
      // Fail closed: an unscoped insert would create a NULL/global row on a
      // sensitive table. Require an explicit organization or a resolved tenant.
      throw new AlephaError(
        `Refusing to insert into tenant-scoped entity '${this.tableName}' with no organization set and no resolved tenant in context (strict tenancy).`,
      );
    }
  }

  /**
   * Resolve the value used for `PG_ORGANIZATION` scoping.
   *
   * Priority:
   * 1. Request-bound tenant (`currentTenantAtom`) — set by an app-level
   *    middleware from the request `Host`. Lets cross-tenant users (admins,
   *    agency operators) be scoped to the tenant they are acting in rather
   *    than the one they belong to.
   * 2. Authenticated user's `organization` — the legacy single-tenant case.
   */
  protected resolveOrganizationValue(): string | undefined {
    const tenant = this.alepha.store.get(currentTenantAtom);
    if (tenant?.id) {
      return tenant.id;
    }

    const user = this.alepha.store.get(currentUserAtom);
    return user?.organization;
  }

  protected organizationField(): PgAttrField | undefined {
    const fields = getAttrFields(this.entity.schema, PG_ORGANIZATION);
    if (fields.length > 0) {
      return fields[0];
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
      : (this.entity.updateSchema.partial() as ZObject); // update

    // Extract raw SQL expressions before codec validation — the schema
    // would reject them since they aren't plain values of the declared type
    // (e.g. `sql\`count + 1\`` for an integer column). They're re-attached
    // after encoding so Drizzle still receives them as live SQL.
    const sqlValues: Record<string, unknown> = {};
    const scalarData: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (value != null && isSQLWrapper(value)) {
        sqlValues[key] = value;
      } else {
        scalarData[key] = value;
      }
    }

    const encoded = this.alepha.codec.encode(schema, scalarData) as Record<
      string,
      unknown
    >;

    // On UPDATE, only persist the fields the caller explicitly provided.
    // Validating against a (partial) schema re-applies every field's default —
    // zod's `ZodDefault` fills in its default whenever the key is ABSENT — which
    // would clobber unrelated existing columns (e.g. an unrelated `status` update
    // resetting `dunningAttempt` back to its default 0). Inserts still want the
    // injected defaults, so the filtering is update-only.
    const result = insert
      ? encoded
      : Object.keys(scalarData).reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = encoded[key];
          return acc;
        }, {});

    return { ...result, ...sqlValues } as PgInsertValue<
      PgTableWithColumns<SchemaToTableConfig<T>>
    >;
  }

  /**
   * Transform a row from the database into a clean entity.
   */
  protected clean<T extends ZObject>(
    row: Record<string, unknown>,
    schema: T,
  ): Infer<T> {
    for (const key of Object.keys(z.schema.shape(schema))) {
      const prop = z.schema.shape(schema)[key];
      // Unwrap optional/nullable so format detection works on the base type.
      const value = z.schema.unwrap(prop);

      // An optional field maps to a NULLABLE column; the driver returns `null`
      // for an empty column. Normalize to "absent" so it satisfies the
      // optional schema and the `T | undefined` contract (the schema only
      // accepts `undefined`, not `null`).
      if (row[key] === null && z.schema.isOptional(prop)) {
        delete row[key];
        continue;
      }

      // convert PG date-time and date to ISO strings
      if (typeof row[key] === "string") {
        if (z.schema.isDateTime(value)) {
          row[key] = this.dateTimeProvider.of(row[key]).toISOString();
        } else if (z.schema.isDate(value)) {
          row[key] = this.dateTimeProvider
            .of(`${row[key]}T00:00:00Z`)
            .toISOString()
            .split("T")[0];
        }
      }

      // convert BigInt to string for `z.bigint()` (string-format) columns.
      // Postgres bigint columns hand back a JS `bigint`; the SQLite builder maps
      // a bigint primary key to an integer column that returns a plain `number`.
      // Both must become a string to satisfy the string-typed bigint schema.
      if (
        (typeof row[key] === "bigint" || typeof row[key] === "number") &&
        z.schema.isBigInt(value)
      ) {
        row[key] = String(row[key]);
      }
    }

    return this.alepha.codec.decode(schema, row) as Infer<T>;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // INTERNAL METHODS

  /**
   * Clean a row with joins recursively
   */
  protected cleanWithJoins<T extends ZObject>(
    row: Record<string, unknown>,
    schema: T,
    joins: PgJoin[],
    parentPath?: string,
  ): Infer<T> {
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

    return entity as Infer<T>;
  }

  /**
   * Build a cache key from the method name, the caller's query, AND the
   * predicate this repository adds on top of it.
   *
   * The scope suffix is what makes `opts.cache` safe. Keyed on the caller's
   * query alone, two tenants issuing the identical `findMany` shared one entry
   * and whichever arrived first filled it for everyone — a cross-tenant read
   * caused by nothing but switching on a performance flag. The same omission
   * let a `force: true` read (which deliberately includes soft-deleted rows)
   * poison the entry a normal read then consumed.
   *
   * `readWhere()` is exactly the org + soft-delete envelope applied to the
   * statement, so folding it in keeps one cache entry per (query, tenant,
   * visibility) triple. It also throws on strict tenancy with no tenant
   * resolved, which is the correct answer on a cached read too — the entry
   * must not be reachable without a tenant when the query itself would not be.
   */
  protected buildCacheKey(
    method: string,
    query: any,
    opts: StatementOptions = {},
  ): string {
    const scope = JSON.stringify(this.readWhere(query?.where ?? {}, opts));
    return `${method}:${JSON.stringify(query)}:${scope}`;
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
        eq: z.schema.isString(this.id.type) ? String(id) : Number(id),
      },
    } as PgQueryWhere<T>;
  }

  /**
   * Find a primary key in the schema.
   */
  protected getPrimaryKey(schema: ZObject) {
    const primaryKeys = getAttrFields(schema, PG_PRIMARY_KEY);
    if (primaryKeys.length === 0) {
      // Surface the table name and tell the dev exactly what to add.
      // Without this hint the same throw bubbles up as a generic
      // "Delete query has failed" via handleError, because deleteMany
      // resolves the PK column id at runtime via `.returning({ id })`.
      // Caught us once on `archive_names`: insert path uses
      // `.returning(this.table)` (no PK touched) so creates worked
      // silently, then every delete blew up.
      throw new AlephaError(
        `Primary key not found on table '${this.tableName}' — mark a column with db.primaryKey(). Required for deleteMany / deleteById / save / getWhereId.`,
      );
    }

    if (primaryKeys.length > 1) {
      throw new AlephaError(
        `Multiple primary keys (${primaryKeys.length}) are not supported on table '${this.tableName}'`,
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
   * - `PgAsyncTransaction` — use this specific transaction (explicit)
   * - `null` — force no transaction, bypass implicit context
   */
  tx?: PgAsyncTransaction<any, Record<string, any>> | null;

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
