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
  asc,
  avg,
  count,
  countDistinct,
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
  SQL,
  sql,
  sum,
} from "drizzle-orm";
import {
  alias,
  type PgAsyncDatabase,
  type PgAsyncTransaction,
  type PgColumn,
  type PgInsertValue,
  type PgTable,
  type PgTableWithColumns,
  type PgUpdateSetSource,
} from "drizzle-orm/pg-core";

import {
  PG_DELETED_AT,
  PG_PRIMARY_KEY,
  PG_UPDATED_AT,
  PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import { DbConflictError } from "../errors/DbConflictError.ts";
import { DbEntityNotFoundError } from "../errors/DbEntityNotFoundError.ts";
import { DbError } from "../errors/DbError.ts";
import { DbTimeoutError } from "../errors/DbTimeoutError.ts";
import { DbVersionMismatchError } from "../errors/DbVersionMismatchError.ts";
import { getAttrFields, type PgAttrField } from "../helpers/pgAttr.ts";
import type {
  AggregateOp,
  AggregateQuery,
  AggregateResult,
  AggregateSelect,
} from "../interfaces/AggregateQuery.ts";
import type { DbColumn, DbTable } from "../interfaces/DbTable.ts";
import type { DbTransaction } from "../interfaces/DbTransaction.ts";
import type {
  PgQueryRelations,
  PgRelationMap,
  PgStatic,
} from "../interfaces/PgQuery.ts";
import type {
  PgQueryWhere,
  PgQueryWhereOrSQL,
} from "../interfaces/PgQueryWhere.ts";
import type { RowLock } from "../interfaces/RowLock.ts";
import type { TransactionOptions } from "../interfaces/TransactionOptions.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import { DbCacheProvider } from "../providers/DbCacheProvider.ts";
import {
  DatabaseProvider,
  type SQLLike,
} from "../providers/drivers/DatabaseProvider.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { TObjectUpdate } from "../schemas/updateSchema.ts";
import { DbErrorParser } from "./DbErrorParser.ts";
import { PgRelationManager } from "./PgRelationManager.ts";
import { type PgJoin, QueryManager } from "./QueryManager.ts";

export abstract class Repository<T extends ZObject> {
  public readonly entity: EntityPrimitive<T>;
  public readonly provider: DatabaseProvider;

  protected readonly log = $logger();
  /**
   * @internal Driver plumbing, outside semver.
   */
  protected readonly relationManager = $inject(PgRelationManager);
  /**
   * @internal Driver plumbing, outside semver.
   */
  protected readonly queryManager = $inject(QueryManager);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  // Injected, not `new`'d: bypassing DI made it impossible to substitute in
  // tests and gave every repository its own unbounded Map.
  protected readonly dbCache = $inject(DbCacheProvider);
  protected readonly errorParser = $inject(DbErrorParser);
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
    col: DbColumn;
  } {
    const pk = this.getPrimaryKey(this.entity.schema);
    return { ...pk, col: pk.col as unknown as DbColumn };
  }

  /**
   * The table, as a reference for raw SQL: interpolated in a `sql` template
   * it renders the table name, and each property is one of its columns.
   *
   * @example
   * ```ts
   * await repo.updateById(id, { count: sql`${repo.table.count} + 1` });
   * await repo.query(sql`SELECT * FROM ${repo.table} WHERE ${repo.table.age} > ${18}`);
   * ```
   *
   * The drizzle table behind it is `Drizzle.table(repo)`, from
   * `alepha/orm/drizzle`.
   */
  public get table(): DbTable<T> {
    return this.pgTable as unknown as DbTable<T>;
  }

  /**
   * The drizzle table of this repository.
   *
   * @internal Outside semver: `Drizzle.table(repo)` from `alepha/orm/drizzle`.
   */
  protected get pgTable(): PgTableWithColumns<any> {
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
   *
   * @internal Driver plumbing, outside semver.
   */
  protected get db(): PgAsyncDatabase<any> {
    const tx = this.alepha.get("alepha.orm.tx") as unknown as
      | PgAsyncTransaction<any>
      | undefined;
    return tx ?? this.provider.db;
  }

  /**
   * The handle a statement runs on: the explicit `tx`, none when `tx` is
   * `null`, the ambient transaction otherwise.
   *
   * @internal
   */
  protected connection(opts: StatementOptions = {}): PgAsyncDatabase<any> {
    if (opts.tx === null) {
      return this.provider.db;
    }
    return (opts.tx as unknown as PgAsyncDatabase<any> | undefined) ?? this.db;
  }

  /**
   * Execute a SQL query.
   *
   * This method allows executing raw SQL queries against the database.
   * This is by far the easiest way to run custom queries that are not covered by the repository's built-in methods!
   *
   * You must use the `sql` tagged template function from Drizzle ORM to create the query. https://orm.drizzle.team/docs/sql
   *
   * It runs on the same handle as the other methods: inside a
   * `$transactional` block, on that transaction, whatever the driver.
   *
   * ⚠️ A raw statement skips everything the other methods do for a write: it
   * does not stamp `updatedAt`, bump a `db.version()` column, invalidate the
   * query cache or emit repository events. A raw UPDATE on a versioned table
   * writes `version = version + 1` itself, or a concurrent `save()` never
   * sees the change.
   *
   * @example
   * ```ts
   * class App {
   *   repository = $repository(userEntity);
   *   async getAdults() {
   *     const users = repository.table;
   *     await repository.query(sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`);
   *   }
   * }
   * ```
   */
  public async query<R extends ZObject = T>(
    raw: SQLLike,
    schema?: R,
  ): Promise<Infer<R>[]> {
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
      for (const colKey of Object.keys(this.pgTable)) {
        this.columnNameMap.set(this.pgTable[colKey].name, colKey);
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
   *
   * @internal Driver plumbing, outside semver.
   */
  protected col(name: keyof Infer<T>): PgColumn {
    const column = (this.pgTable as any)[name];
    if (!column) {
      throw new AlephaError(
        `Invalid access. Column '${String(name)}' not found in table '${this.tableName}'`,
      );
    }

    return column;
  }

  /**
   * The value a conflicting row arrived with, as an SQL fragment: the
   * `excluded` pseudo-table both Postgres and SQLite expose inside
   * `ON CONFLICT ... DO UPDATE`.
   *
   * It names the column by its physical name, read off the table, so a
   * property whose column is spelled differently (`createdAt` stored as
   * `created_at`) or a later rename cannot leave a hand-typed
   * `excluded.<name>` stale.
   *
   * ⚠️ Meaningful only inside the `set` of {@link upsert} or
   * {@link upsertMany}. Anywhere else the database refuses it, or worse,
   * resolves it against a table that happens to be called `excluded`.
   *
   * @example
   * ```ts
   * const t = repo.table;
   * await repo.upsertMany(rows, {
   *   target: ["path", "hour"],
   *   set: { count: sql`${t.count} + ${repo.excluded("count")}` },
   * });
   * ```
   */
  public excluded<K extends keyof Infer<T>>(key: K): SQL<Infer<T>[K]> {
    return sql<Infer<T>[K]>`excluded.${sql.identifier(this.col(key).name)}`;
  }

  /**
   * A subquery over this table, compiled from a where-object, for `exists`,
   * `notExists`, `inArray` and `notInArray` of another query.
   *
   * Without `column` it is `(SELECT 1 FROM <table> WHERE ...)`, for
   * `exists` / `notExists`; with one it selects that column, for `inArray` /
   * `notInArray`. The soft-delete filter is added like on any read, unless
   * `opts.force`.
   *
   * It correlates through a column of the outer query used as a comparison
   * value. The subquery's own table is always aliased (`<table>_sq`), so a
   * subquery over the outer query's own table works: its columns render as
   * `"quests_sq"."id"`, the outer ones as `"quests"."depends_on"`.
   *
   * ⚠️ A subquery of this table cannot nest another subquery of this same
   * table: the two aliases would collide, and it throws.
   *
   * @example
   * ```ts
   * // Epics with no open quest left.
   * await epics.findMany({
   *   where: {
   *     notExists: quests.subquery({
   *       epicId: { eq: epics.table.id },
   *       completedAt: { isNull: true },
   *     }),
   *   },
   * });
   *
   * // Quests outside draft epics.
   * await quests.findMany({
   *   where: {
   *     epicId: { notInArray: epics.subquery({ status: { eq: "draft" } }, "id") },
   *   },
   * });
   * ```
   */
  public subquery(
    where: PgQueryWhereOrSQL<T>,
    column?: keyof Infer<T>,
    opts: { force?: boolean } = {},
  ): SQL {
    const aliasName = `${this.tableName}_sq`;
    this.assertNoNestedSubquery(where, aliasName);

    const inner = alias(this.pgTable as PgTable, aliasName) as any;
    const col = (key: string): PgColumn => {
      const found = inner[key];
      if (!found) {
        throw new AlephaError(
          `Invalid access. Column '${key}' not found in table '${this.tableName}'`,
        );
      }
      return found;
    };

    const condition = this.queryManager.toSQL(
      this.withDeletedAt(where, opts) as PgQueryWhereOrSQL<ZObject>,
      {
        schema: this.entity.schema,
        col,
        dialect: this.provider.dialect,
      },
    );

    const selection = column
      ? { value: col(column as string) }
      : { value: sql`1` };
    let builder = this.provider.db.select(selection).from(inner);
    if (condition) {
      builder = builder.where(condition) as any;
    }

    const result = sql`${builder}`;
    Object.defineProperty(result, Repository.SUBQUERY_ALIAS, {
      value: aliasName,
    });
    return result;
  }

  /**
   * Where `subquery()` records the alias it used on the SQL it returns, so a
   * nested subquery of the same table is caught by name.
   */
  protected static readonly SUBQUERY_ALIAS = Symbol("alepha.orm.subquery");

  /**
   * Refuse a where-object that carries a subquery of this same table: both
   * would be aliased `<table>_sq`, and the inner one would bind to the outer
   * alias silently.
   */
  protected assertNoNestedSubquery(value: unknown, aliasName: string): void {
    if (value == null || typeof value !== "object") {
      return;
    }
    if ((value as any)[Repository.SUBQUERY_ALIAS] === aliasName) {
      throw new AlephaError(
        `A subquery of '${this.tableName}' cannot nest another subquery of '${this.tableName}': ` +
          `both would be aliased '${aliasName}'. Split it into two queries.`,
      );
    }
    // Only the where-object's own structure: plain objects and arrays. A
    // column, a date or any other value is a leaf.
    const proto = Object.getPrototypeOf(value);
    if (
      isSQLWrapper(value) ||
      (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
    ) {
      return;
    }
    for (const nested of Object.values(value)) {
      this.assertNoNestedSubquery(nested, aliasName);
    }
  }

  /**
   * True when every column of `this.pgTable` is excluded from INSERT column
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
    const columns = Object.values(getTableColumns(this.pgTable as PgTable));
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
   * `.returning(this.pgTable)` uses — keyed by the raw primary key value the
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

    const db = this.connection(opts);
    const pkColumn = this.col(this.id.key);
    const [row] = await db.execute<Record<string, unknown>>(
      sql`insert into ${this.pgTable} default values returning ${pkColumn}`,
    );
    const pkValue = row[pkColumn.name] as string | number;
    return this.getById(pkValue, opts);
  }

  /**
   * Run a transaction.
   */
  public async transaction<T>(
    transaction: (tx: DbTransaction) => Promise<T>,
    options?: TransactionOptions,
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
        transaction(this.db as unknown as DbTransaction),
      );
    }

    return await this.db.transaction(
      (tx) => transaction(tx as unknown as DbTransaction),
      this.provider.toDrizzleTransactionConfig(options),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Start a SELECT query on the table.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected rawSelect(opts: StatementOptions = {}) {
    const db = this.connection(opts);
    return db.select().from(this.pgTable as PgTable);
  }

  /**
   * Start a SELECT DISTINCT query on the table.
   */
  /**
   * SELECT of only the requested columns. The primary key is always included
   * so downstream mapping and caching keep working.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected rawSelectColumns(
    opts: StatementOptions = {},
    columns: (keyof Infer<T>)[] = [],
  ) {
    const db = this.connection(opts);
    const table = this.pgTable as PgTable;

    const fields: Record<string, any> = {};
    for (const column of [this.id.key, ...columns]) {
      if (typeof column === "string" && !fields[column]) {
        fields[column] = this.col(column);
      }
    }

    return db.select(fields).from(table);
  }

  /**
   * @internal Driver plumbing, outside semver.
   */
  protected rawSelectDistinct(
    opts: StatementOptions = {},
    columns: (keyof Infer<T>)[] = [],
  ) {
    const db = this.connection(opts);
    const table = this.pgTable as PgTable;

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
   *
   * @internal Driver plumbing, outside semver.
   */
  protected rawInsert(opts: StatementOptions = {}) {
    const db = this.connection(opts);
    return db.insert(this.pgTable);
  }

  /**
   * Start an UPDATE query on the table.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected rawUpdate(opts: StatementOptions = {}) {
    const db = this.connection(opts);
    return db.update(this.pgTable);
  }

  /**
   * Start a DELETE query on the table.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected rawDelete(opts: StatementOptions = {}) {
    const db = this.connection(opts);
    return db.delete(this.pgTable);
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
    // Check cache. Never inside a transaction: a read there can see rows the
    // transaction wrote and may still roll back, and a hit would hide them.
    if (opts.for && opts.cache) {
      // A cache hit takes no row lock: the caller would believe it holds a
      // lock it never took.
      throw new AlephaError(
        `findMany on '${this.tableName}' was given both 'for' and 'cache': a cached result takes no row lock. Drop one of them.`,
      );
    }
    const cache = this.inTransaction(opts) ? undefined : opts.cache;
    if (cache) {
      const cacheKey = cache.key ?? this.buildCacheKey("findMany", query, opts);
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
        this.pgTable,
      );
    }

    const where = this.withDeletedAt(
      (query.where ?? {}) as PgQueryWhere<T>,
      opts,
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
      } else {
        builder.for(
          opts.for.mode,
          opts.for.onLocked === "skip"
            ? { skipLocked: true }
            : { noWait: true },
        );
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
      if (cache) {
        const cacheKey =
          cache.key ?? this.buildCacheKey("findMany", query, opts);
        await this.dbCache.set(this.tableName, cacheKey, result, cache.ttl);
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
      throw new DbEntityNotFoundError({ entity: this.tableName });
    }

    return entity;
  }

  /**
   * Find entities with pagination.
   *
   * It uses the same parameters as `findMany()`, but adds pagination metadata to the response.
   * Paging comes from `pagination` alone: `limit`/`offset` in the query are
   * refused, `size` is held to `[1, 100]`, and `pagination.sort` wins over
   * the query's `orderBy`, which is the default order.
   *
   * > Pagination CAN also do a count query to get the total number of elements.
   */
  public async paginate<R extends PgRelationMap<T>>(
    pagination: PageQuery = {},
    query: Omit<PgQueryRelations<T, R>, "where" | "limit" | "offset"> & {
      where?: PgQueryWhere<T, R>;
    } = {},
    opts: StatementOptions & { count?: boolean } = {},
  ): Promise<Page<PgStatic<T, R>>> {
    // Overflow-safe: size is held to [1, 100] and page to >= 0, so page
    // would need to exceed 2^45 to overflow Number.MAX_SAFE_INTEGER.
    const paging = this.queryManager.pageWindow(
      pagination,
      query,
      this.tableName,
    );
    const { limit, offset } = paging;
    const orderBy = paging.orderBy as typeof query.orderBy;

    const now = this.dateTimeProvider.nowMillis();
    const timers = {
      query: now,
      count: now,
    };

    const tasks: Promise<any>[] = [];

    const countWhere = opts.count
      ? this.withDeletedAt((query.where ?? {}) as PgQueryWhere<T>, opts)
      : undefined;

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
      tasks.push(
        this.countForPage(
          countWhere as PgQueryWhereOrSQL<T>,
          query.with,
          opts,
        ).then((it: number) => {
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
   * The count half of {@link paginate}, over the SAME joins as the row half.
   *
   * It used to be a bare `$count(this.pgTable, where)`. A `where` on a relation
   * key then resolved against the base table, where a key like `city` happens
   * to exist as a column reference, so the comparison compiled and matched
   * nothing: the rows came back correct and the total came back 0. Silently.
   *
   * With joins in play the count has to be DISTINCT over the primary key. A
   * one-to-many join returns one row per child, and counting those would
   * report a user with three posts as three users.
   */
  protected async countForPage(
    where: PgQueryWhereOrSQL<T>,
    withRelations: PgRelationMap<T> | undefined,
    opts: StatementOptions = {},
  ): Promise<number> {
    // Same db resolution as `count()`: `this.db` ignored an explicit
    // `opts.tx`, so `paginate(..., { count: true, tx })` ran its count
    // OUTSIDE the transaction — reading rows the transaction had not
    // committed, or missing rows it had written.
    const db = this.connection(opts);

    try {
      return await this.runCountForPage(db, where, withRelations);
    } catch (error) {
      // The `findMany` task beside this one in `paginate`'s `Promise.all` is
      // wrapped; this one was not, so the two halves of the same call
      // reported failures in different shapes. See `count()` for what a raw
      // drizzle error puts in its message.
      throw this.handleError(error, "Query count has failed");
    }
  }

  /**
   * The statement itself, split out so the wrapper above stays one `try`
   * around every path rather than one per branch.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected async runCountForPage(
    db: PgAsyncDatabase<any>,
    where: PgQueryWhereOrSQL<T>,
    withRelations: PgRelationMap<T> | undefined,
  ): Promise<number> {
    if (!withRelations) {
      return await db.$count(this.pgTable, this.toSQL(where));
    }

    const builder = db
      .select({ total: countDistinct(this.col(this.id.key)) })
      .from(this.pgTable as PgTable);

    const joins: Array<PgJoin> = [];
    this.relationManager.buildJoins(
      this.provider,
      builder as never,
      joins,
      withRelations as PgRelationMap<ZObject>,
      this.pgTable,
    );

    builder.where(this.toSQL(where, joins));

    const rows = await builder.execute();
    return Number(rows[0]?.total ?? 0);
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
      throw new DbEntityNotFoundError({ entity: this.tableName });
    }

    return entity;
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
            .returning(this.pgTable)
            .then(([it]) => this.clean(it, this.entity.schema));

      await this.invalidateCache(opts);

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
   * Inserts are batched: at most `batchSize` rows (default 1000) per
   * statement, and fewer when that many rows would bind more values than
   * the driver accepts (see {@link Repository.insertBatchSize}).
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

    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data: values,
    });

    // Batches are NOT one atomic unit unless the caller wraps the call in
    // `$transactional`: a failure in batch N leaves batches 1..N-1 committed.
    // Documented rather than silently wrapped, because an implicit
    // transaction around an arbitrarily large insert is its own hazard (lock
    // duration, WAL growth) and the caller is better placed to decide.
    const rows = values.map((data) => this.cast(data, true));
    const batchSize = this.insertBatchSize(rows, opts.batchSize);
    const allEntities: Infer<T>[] = [];

    try {
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const entities = await this.rawInsert(opts)
          .values(batch)
          .returning(this.pgTable)
          .then((rows) => rows.map((it) => this.clean(it, this.entity.schema)));
        allEntities.push(...entities);
      }

      await this.invalidateCache(opts);

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
   * Rows per INSERT statement: the caller's `batchSize` (default 1000),
   * capped so that rows times columns stays within the driver's
   * `maxBoundParameters`. Every provided column of every row is one bound
   * value, so on Cloudflare D1 (ceiling 100) a five-column table inserts
   * twenty rows at a time. The flat thousand used to bind five thousand
   * there and fail on the twenty-first row, which is how Lore's reference
   * converter (epic #32) died on a folio with 28 links on 2026-09-05.
   *
   * A row wider than the ceiling gets a batch of one and the driver's own
   * refusal, which is the honest answer: no batching can bind it.
   *
   * `reserved` is what the rest of the statement binds whatever the row
   * count: an upsert's `DO UPDATE SET` clause, which {@link upsertMany}
   * measures and passes here.
   */
  protected insertBatchSize(
    rows: ReadonlyArray<Record<string, unknown>>,
    requested?: number,
    reserved = 0,
  ): number {
    const columns = this.boundPerRow(rows, this.generatedColumns());

    const perStatement = Math.max(
      1,
      Math.floor((this.provider.maxBoundParameters - reserved) / columns),
    );
    return Math.max(1, Math.min(requested ?? 1000, perStatement));
  }

  /**
   * The columns that bind a value on every inserted row the caller leaves
   * out: see the comment inside for which defaults do and which do not.
   */
  protected generatedColumns(): string[] {
    const tableColumns = getTableColumns(this.pgTable as PgTable);

    // ⚠️ The caller's keys are NOT the whole statement. A column the caller
    // never names still binds a value on every row when its default is a
    // JavaScript one: drizzle calls `defaultFn()`, or takes a plain `default`
    // value, and pushes the result as a parameter. Only an SQL default is
    // inlined into the statement, and only a column with no default at all
    // falls back to the `default` keyword — neither of those binds.
    //
    // A generated uuid primary key (`defaultFn`) and `version` (a plain `0`)
    // are both bound, so sizing from the provided keys alone under-counted by
    // TWO on every row: a 14-row insert of 7 provided columns bound 126
    // values against D1's ceiling of 100 and was refused (quest #Q343).
    // `createdAt` / `updatedAt` are inlined as `unixepoch(...)` and rightly
    // do not count.
    return Object.entries(tableColumns)
      .filter(
        ([, col]: [string, any]) =>
          col.defaultFn !== undefined ||
          (col.default !== undefined && !(col.default instanceof SQL)) ||
          (col.default === undefined && col.onUpdateFn !== undefined),
      )
      .map(([key]) => key);
  }

  /**
   * Values the widest of `rows` binds in an INSERT: its provided keys plus
   * every generated column it leaves out. The widest decides, since every row
   * of a statement binds the union of the provided columns.
   */
  protected boundPerRow(
    rows: ReadonlyArray<Record<string, unknown>>,
    generated: string[],
  ): number {
    return rows.reduce((max, row) => {
      // `undefined` reads as absent to drizzle, so it takes the default path.
      let bound = Object.values(row).filter((v) => v !== undefined).length;
      for (const key of generated) {
        if (row[key] === undefined) bound++;
      }
      return Math.max(max, bound);
    }, 1);
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
   *
   * // Update from the incoming row: `excluded()` names its value
   * await repo.upsert(
   *   { email: "alice@example.com", name: "Alice" },
   *   { target: ["email"], set: { name: repo.excluded("name") } },
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
    this.withVersionBump(setData);

    // Scope the conflict update to non-deleted rows so an upsert cannot
    // silently resurrect a soft-deleted row. Plain entities keep the original
    // statement byte-for-byte.
    const setWhere = this.deletedAt()
      ? this.toSQL(this.withDeletedAt({} as PgQueryWhere<T>, opts))
      : undefined;

    try {
      const entity = await this.rawInsert(opts)
        .values(this.cast(data ?? {}, true))
        .onConflictDoUpdate({
          target: targetColumns,
          set: setData,
          ...(setWhere ? { setWhere } : {}),
        })
        .returning(this.pgTable)
        .then(([it]) => {
          if (!it) {
            // The conflicting row is already deleted, so the guarded UPDATE
            // matched nothing and no row was inserted. Fail loudly rather
            // than cleaning `undefined`.
            throw new AlephaError(
              `Upsert on '${this.tableName}' conflicted with an already-deleted row; refusing to overwrite it.`,
            );
          }
          return this.clean(it, this.entity.schema);
        });

      await this.invalidateCache(opts);

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
   * Insert or update many entities in as few statements as the driver allows.
   *
   * The reason to reach for this over a loop of {@link upsert} is round-trips:
   * against a remote database (D1 in particular) a batch of twenty becomes one
   * network call instead of twenty, which is usually the whole cost.
   *
   * One statement when the rows fit, otherwise one per batch, sized like
   * {@link createMany}'s from the driver's `maxBoundParameters` less what the
   * `ON CONFLICT … DO UPDATE SET` clause binds itself. It used to be one
   * statement whatever the count, so on D1 (a ceiling of 100) a fourteen-value
   * row failed from its eighth: Lore's hourly analytics rollup failed on every
   * run for a week with `too many SQL variables` (#Q2404). Like
   * `createMany`, the batches are not one atomic unit unless the caller wraps
   * the call in `$transactional`.
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
   *    `excluded` pseudo-table both engines expose, through {@link excluded}:
   *    `set: { hits: sql`${t.hits} + ${repo.excluded("hits")}` }`.
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
   *     set: { count: sql`${repo.table.count} + ${repo.excluded("count")}` },
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
        setData[key] = this.excluded(key);
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
        setData[key as string] = this.excluded(key);
      }
    }

    setData = this.cast(setData, false) as any;
    this.withVersionBump(setData);

    const setWhere = this.deletedAt()
      ? this.toSQL(this.withDeletedAt({} as PgQueryWhere<T>, opts))
      : undefined;

    const statement = (batch: Array<Record<string, unknown>>) =>
      this.rawInsert(opts)
        .values(batch as never)
        .onConflictDoUpdate({
          target: targetColumns,
          set: setData,
          ...(setWhere ? { setWhere } : {}),
        });

    try {
      const casted = values.map((value) => this.cast(value ?? {}, true));

      // What the SET and WHERE clauses bind on their own, read off the real
      // statement for one row rather than guessed: an `excluded.<col>`
      // reference binds nothing, a plain value or the `updatedAt` stamp binds
      // one, and only drizzle knows which is which once `cast` has run.
      const oneRow = (statement([casted[0]]) as any).toSQL().params.length;
      const reserved = Math.max(
        0,
        oneRow - this.boundPerRow([casted[0]], this.generatedColumns()),
      );
      const batchSize = this.insertBatchSize(casted, undefined, reserved);

      const rows: any[] = [];
      for (let i = 0; i < casted.length; i += batchSize) {
        rows.push(
          ...(await statement(casted.slice(i, i + batchSize)).returning(
            this.pgTable,
          )),
        );
      }

      const entities = rows.map((row: any) =>
        this.clean(row, this.entity.schema),
      );

      await this.invalidateCache(opts);

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
   *
   * Stamps the `db.updatedAt()` column unless `opts.touch` is `false`; see
   * {@link UpdateOptions.touch}.
   */
  public async updateOne(
    where: PgQueryWhereOrSQL<T>,
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: UpdateOptions = {},
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

    if (updatedAtField && opts.touch !== false) {
      row[updatedAtField.key] =
        opts.now ?? this.dateTimeProvider.nowISOString();
    }

    where = this.withDeletedAt(where, opts);
    row = this.cast(row, false) as any;

    // do not update the ID field
    delete row[this.id.key];
    this.withVersionBump(row);

    const response = await this.rawUpdate(opts)
      .set(row)
      .where(this.toSQL(where))
      .returning(this.pgTable)
      .catch((error) => {
        throw this.handleError(error, "Update query has failed");
      });

    if (!response[0]) {
      throw new DbEntityNotFoundError({ entity: this.tableName });
    }

    try {
      const entity = this.clean(response[0], this.entity.schema);

      await this.invalidateCache(opts);

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
  public async save(entity: Infer<T>, opts: UpdateOptions = {}): Promise<void> {
    // A copy, assigned back only once the write succeeded: on a version
    // mismatch the caller's object is exactly what it loaded, so a retry of
    // it fails again instead of matching the concurrent writer's version and
    // overwriting it.
    const row = { ...(entity as Record<string, unknown>) } as any;

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

    // The version is bumped by `updateOne` itself, in SQL, like every other
    // update: only the version this object was loaded with goes in the WHERE.
    const versionField = this.versionField();
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
    }

    try {
      const newValue = await this.updateOne(where, row, opts);
      const target = entity as any;
      for (const key of Object.keys(z.schema.shape(this.entity.schema))) {
        target[key] = undefined;
      }
      Object.assign(target, newValue);
    } catch (error) {
      if (error instanceof DbEntityNotFoundError && versionField) {
        // Verify entity still exists to differentiate between not-found vs version mismatch
        try {
          // If getById succeeds, entity exists and this was a version mismatch
          await this.getById(id);
          throw new DbVersionMismatchError({ table: this.tableName, id });
        } catch (lookupError) {
          // If it's still not found, propagate the original not found error
          if (lookupError instanceof DbEntityNotFoundError) {
            throw error; // Original error
          }
          // A version mismatch, or another error (network, timeout, etc.)
          throw lookupError;
        }
      }
      throw error;
    }
  }

  /**
   * Find an entity by ID and update it.
   *
   * Takes {@link UpdateOptions}, so `{ touch: false }` leaves `updatedAt`
   * alone.
   */
  public async updateById(
    id: string | number,
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: UpdateOptions = {},
  ): Promise<Infer<T>> {
    return await this.updateOne(this.getWhereId(id), data, opts);
  }

  /**
   * Find many entities and update all of them.
   *
   * Stamps the `db.updatedAt()` column unless `opts.touch` is `false`; see
   * {@link UpdateOptions.touch}.
   *
   * @example
   * ```ts
   * // Bookkeeping, not an edit: an activity feed scanning `updatedAt`
   * // must not report every release as changed.
   * await releases.updateMany(
   *   { projectId: { eq: projectId }, defaultSince: { isNotNull: true } },
   *   { defaultSince: null },
   *   { touch: false },
   * );
   * ```
   */
  public async updateMany(
    where: PgQueryWhereOrSQL<T>,
    data: WithSQL<Infer<TObjectUpdate<T>>>,
    opts: UpdateOptions = {},
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

    if (updatedAtField && opts.touch !== false) {
      // Shallow-copy before stamping: writing into the caller's object means a
      // reused patch carries a stale `updatedAt` into the next call.
      data = {
        ...(data as Record<string, unknown>),
        [updatedAtField.key]: opts.now ?? this.dateTimeProvider.nowISOString(),
      } as typeof data;
    }

    where = this.withDeletedAt(where, opts);
    data = this.cast(data, false) as any;
    this.withVersionBump(data as Record<string, unknown>);
    try {
      const entities = await this.rawUpdate(opts)
        .set(data as PgUpdateSetSource<PgTableWithColumns<any>>)
        .where(this.toSQL(where))
        .returning();

      await this.invalidateCache(opts);

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

    await this.alepha.events.emit("repository:delete:before", {
      tableName: this.tableName,
      where,
    });

    try {
      const result = await this.rawDelete(opts)
        .where(this.toSQL(where))
        .returning({ id: (this.pgTable as any)[this.id.key] });
      const ids = result.map((row) => row.id);

      await this.invalidateCache(opts);

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
        { entity: this.tableName },
        { message: `Entity with ID ${id} not found in ${this.tableName}` },
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
    // Announced like `findMany`, and for the reason that matters to a
    // listener: a count is a full round trip to the database. A counter
    // wired to this event was blind to every `count()` in the app, so the
    // shape it exists to catch — one count per row of a page — read as zero
    // reads.
    await this.alepha.events.emit("repository:read:before", {
      tableName: this.tableName,
      query: { where },
    });

    where = this.withDeletedAt(where, opts);
    const db = this.connection(opts);
    try {
      return await db.$count(this.pgTable, this.toSQL(where));
    } catch (error) {
      // Wrapped like every sibling statement, and this one was not. A raw
      // drizzle error carries the SQL and its BOUND VALUES in the message —
      // `Failed query: select count(*) from "quests" where ... params: 1,1` —
      // so on a filtered query it publishes whatever the caller filtered on
      // into error reporting. That text reached Lore's blight inbox
      // (#326, beside #325 which is the same incident through `findMany`,
      // classified and scrubbed).
      //
      // Classification matters as much as scrubbing: `handleError` runs
      // `DbTimeoutError.from` first, because drizzle demotes the driver's
      // error to `cause`. A count that timed out surfaced as an
      // unclassified 500, so the caller was never told the one thing it
      // could act on. And code catching `DbError` missed this path entirely.
      throw this.handleError(error, "Query count has failed");
    }
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
   *
   * An operation may instead take `{ column, where }`, which compiles to
   * `COUNT(CASE WHEN <where> THEN <column> END)`. `column` turns the key into
   * an alias, so several differently-conditioned aggregates over one column
   * can share a single pass:
   *
   * @example
   * ```ts
   * await repo.aggregate({
   *   select: {
   *     category: true,
   *     id: { count: true },
   *     paid: { count: { column: "id", where: { paidAt: { isNotNull: true } } } },
   *   },
   *   groupBy: ["category"],
   * });
   * ```
   *
   * ⚠️ The per-aggregate `where` NARROWS: it is ANDed inside the CASE while
   * this query's own `where` and the soft-delete filter still govern which
   * rows are seen at all. A key is
   * either a column or an alias, never both and never neither; see
   * {@link AggregateOpSelect} and `assertAggregateKey`.
   *
   * A key may also be computed: `{ expr: SQL }` selects an expression under
   * that alias, to group and order by, and an operation may read an
   * expression instead of a column with `{ expr }` in place of `column`:
   *
   * @example
   * ```ts
   * const t = quests.table;
   * await quests.aggregate({
   *   select: {
   *     day: { expr: sqlx.dateDay(t.createdAt) },
   *     id: { count: true },
   *     cycle: { avg: { expr: sqlx.dateDiff(t.completedAt, t.acceptedAt, "hours") } },
   *   },
   *   where: { createdAt: { gte: dateTime.now().subtract(7, "day").toISOString() } },
   *   groupBy: ["day"],
   *   orderBy: "day",
   * });
   * // -> Array<{ day: string; id: { count: number }; cycle: { avg: number } }>
   * ```
   *
   * An `expr` key groups and orders by its alias, never by the expression
   * rendered again (Postgres would refuse it once the expression binds a
   * parameter), so it may not be spelled like a column. `min` / `max` over an
   * expression are typed and decoded as the expression's `SQL<T>`.
   */
  public async aggregate<S extends AggregateSelect<T>>(
    query: AggregateQuery<T, S>,
    opts: StatementOptions = {},
  ): Promise<AggregateResult<T, S>[]> {
    const AGG_SEPARATOR = "___";

    // Same reasoning as `count()`: one aggregate is one round trip, and a
    // listener counting reads must see it.
    await this.alepha.events.emit("repository:read:before", {
      tableName: this.tableName,
      query,
    });

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

    /**
     * The expression one operation aggregates over.
     *
     * `column` re-points it; `where` wraps it in a CASE so only the matching
     * rows contribute. ⚠️ The condition is ANDed INSIDE the CASE and never
     * touches the statement's own WHERE, which is where `withDeletedAt` lives.
     * A per-aggregate condition that replaced or short-circuited that clause
     * would resurrect soft-deleted rows.
     */
    const aggExpr = (key: string, op: AggregateOp, spec: any) => {
      const source =
        spec && typeof spec === "object" && spec.expr ? spec.expr : undefined;
      const columnName =
        spec && typeof spec === "object" && spec.column ? spec.column : key;
      const column = source ?? this.col(columnName);
      const condition =
        spec && typeof spec === "object" && spec.where
          ? this.toSQL(spec.where)
          : undefined;
      const value = condition
        ? sql`CASE WHEN ${condition} THEN ${column} END`
        : column;

      // An expression has no column to decode with, and drizzle's `min` /
      // `max` fall back to `String` for anything that is not a column: a
      // numeric min would come back as "3". Emitted bare, they decode as the
      // driver returns them, which is what `SQL<T>` types them as.
      if (source && (op === "min" || op === "max")) {
        return op === "min" ? sql`min(${value})` : sql`max(${value})`;
      }

      // No condition means no CASE at all: `{ count: { column: "id" } }` is
      // just a renamed plain aggregate.
      if (!condition) {
        return aggFn(op, column as any);
      }

      const expr = aggFn(op, value);

      // ⚠️ Re-attach the column's decoder. drizzle's `min` / `max` map with
      // the column only when the expression IS a column, and fall back to
      // `String` otherwise — so wrapping in a CASE turned an integer max into
      // "30" and a timestamp into whatever the driver printed. `count` /
      // `sum` / `avg` are unaffected: they are coerced with Number() when the
      // row is re-nested, the way they always were.
      return op === "min" || op === "max"
        ? (expr as SQL).mapWith(column as any)
        : expr;
    };

    // Keys computed by `{ expr }`: grouped and ordered by their alias.
    const exprKeys = new Set<string>();

    for (const [key, select] of Object.entries(query.select)) {
      if (select === true) {
        flatFields[key] = this.col(key);
        continue;
      }
      if (typeof select !== "object" || select === null) {
        continue;
      }
      if ("expr" in select) {
        this.assertAggregateAlias(key);
        exprKeys.add(key);
        flatFields[key] = sql`${(select as { expr: SQL }).expr}`.as(key);
        continue;
      }
      this.assertAggregateKey(key, select);
      for (const op of Object.keys(select) as AggregateOp[]) {
        const spec = (select as Record<string, unknown>)[op];
        if (!spec) continue;
        const alias = `${key}${AGG_SEPARATOR}${op}`;
        const expr = aggExpr(key, op, spec);
        // ⚠️ ALIAS every aggregate. A raw SQL expression in a select list is
        // emitted verbatim, so the driver names that result column after the
        // expression TEXT — and two conditioned aggregates over the same
        // column render to the very same text, their conditions differing
        // only in a bound parameter. They then collapse into one field on the
        // way back: two sums split by direction came back 0 and null instead
        // of 700 and 0 (quest #Q344). A plain `sum(col)` never collided,
        // because two of those differ in the column they name.
        flatFields[alias] = expr instanceof SQL ? expr.as(alias) : expr;
      }
    }

    const db = this.connection(opts);
    let builder = db.select(flatFields).from(this.pgTable as PgTable);

    // The soft-delete filter applies even when the caller passes no `where`,
    // like every other read path.
    const where = this.withDeletedAt((query.where ?? {}) as any, opts);
    const whereSql = this.toSQL(where);
    if (whereSql) {
      builder = builder.where(whereSql) as any;
    }

    // GROUP BY
    // An `expr` key groups by its select alias. Rendering the expression a
    // second time would bind its parameters again ($1 in the SELECT, $2 in
    // the GROUP BY), and Postgres refuses a SELECT expression that is not
    // textually the grouped one.
    if (query.groupBy) {
      builder = builder.groupBy(
        ...query.groupBy.map((key) =>
          exprKeys.has(key as string)
            ? sql`${sql.identifier(key as string)}`
            : this.col(key as string),
        ),
      ) as any;
    }

    // HAVING
    if (query.having) {
      const havingConditions: SQL[] = [];
      for (const [key, ops] of Object.entries(query.having)) {
        if (!ops || typeof ops !== "object") continue;
        for (const [op, comparisons] of Object.entries(ops)) {
          if (!comparisons || typeof comparisons !== "object") continue;
          // Rebuilt from the SELECT's own spec, not from the key: a HAVING on
          // a conditioned alias has to compare the same CASE expression the
          // select computed, or it filters on a different number entirely.
          const selected = (query.select as Record<string, any>)[key];
          const spec =
            selected && typeof selected === "object"
              ? selected[op as AggregateOp]
              : undefined;
          const expr = aggExpr(key, op as AggregateOp, spec);
          for (const [cmp, val] of Object.entries(
            comparisons as Record<string, number>,
          )) {
            switch (cmp) {
              case "gt":
                havingConditions.push(gt(expr, val));
                break;
              case "gte":
                havingConditions.push(gte(expr, val));
                break;
              case "lt":
                havingConditions.push(lt(expr, val));
                break;
              case "lte":
                havingConditions.push(lte(expr, val));
                break;
              case "eq":
                havingConditions.push(drizzleEq(expr, val));
                break;
              case "ne":
                havingConditions.push(ne(expr, val));
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
          const col = exprKeys.has(colName)
            ? sql`${sql.identifier(colName)}`
            : flatFields[colName];
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
    let limit = query.limit;
    if (query.offset) {
      builder = builder.offset(query.offset) as any;

      // Same guard as findMany: SQLite rejects OFFSET without LIMIT, so use
      // an effectively unbounded limit rather than truncating or failing.
      if (this.provider.dialect === "sqlite" && !limit) {
        limit = Number.MAX_SAFE_INTEGER;
      }
    }
    if (limit) {
      builder = builder.limit(limit) as any;
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
            // Only the numeric aggregates are coerced. `min` / `max` return
            // the column's own value - drizzle already decoded it with the
            // column's mapper, so a timestamp arrives as a Date - and running
            // that through Number() turned every non-numeric min/max into NaN.
            // Their empty-set answer stays null, because SQL has none.
            result[col][op] =
              op === "count" || op === "sum" || op === "avg"
                ? value != null
                  ? Number(value)
                  : 0
                : (value ?? null);
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

  /**
   * A select key is EITHER a column name or a fresh alias, never both and
   * never neither.
   *
   * The distinction cannot be inferred, and guessing it turns two different
   * mistakes into silence. A misspelt column with no `column` beside it would
   * become an alias over a column that does not exist; an alias spelled like
   * a real column would shadow that column in the result, so a caller reading
   * `row.status` would get a count instead of the status. Both are refused
   * here, with the key named.
   */
  protected assertAggregateKey(key: string, select: object): void {
    const isColumn = (this.pgTable as any)[key] != null;
    const withColumn: string[] = [];
    const withoutColumn: string[] = [];

    for (const [op, spec] of Object.entries(select)) {
      if (!spec) continue;
      if (spec && typeof spec === "object" && spec.column && spec.expr) {
        throw new AlephaError(
          `Aggregate select key '${key}' on '${this.tableName}' names both 'column' and 'expr' (on: ${op}). ` +
            "An operation reads one source: keep one of them.",
        );
      }
      (spec && typeof spec === "object" && (spec.column || spec.expr)
        ? withColumn
        : withoutColumn
      ).push(op);
    }

    if (isColumn && withColumn.length > 0) {
      throw new AlephaError(
        `Aggregate select key '${key}' on '${this.tableName}' is a real column, so it cannot also carry 'column' or 'expr' ` +
          `(on: ${withColumn.join(", ")}). Rename the key to a free-form alias, or drop 'column' to aggregate '${key}' itself.`,
      );
    }

    if (!isColumn && withoutColumn.length > 0) {
      throw new AlephaError(
        `Aggregate select key '${key}' is not a column of '${this.tableName}', so it is an alias and every operation ` +
          `under it must name the column or expression it reads (missing on: ${withoutColumn.join(", ")}). ` +
          "If you meant a column, check the spelling.",
      );
    }

    if (!isColumn && key.includes("___")) {
      throw new AlephaError(
        `Aggregate select alias '${key}' contains '___', which separates the key from the operation in the flat ` +
          "result and would make the row impossible to re-nest. Pick a name without it.",
      );
    }
  }

  /**
   * A select key carrying `{ expr }` is an alias, and it is grouped and
   * ordered by that name. Spelled like one of the entity's columns, by its
   * property or its physical name, it would shadow the column in the result,
   * and Postgres would resolve `GROUP BY <name>` to the input column instead.
   */
  protected assertAggregateAlias(key: string): void {
    const physical = Object.values(
      getTableColumns(this.pgTable as PgTable),
    ).some((column) => column.name === key);
    if ((this.pgTable as any)[key] != null || physical) {
      throw new AlephaError(
        `Aggregate select key '${key}' carries 'expr', so it is an alias, and it is spelled like a column of ` +
          `'${this.tableName}'. Pick a name that is not a column.`,
      );
    }
    if (key.includes("___")) {
      throw new AlephaError(
        `Aggregate select alias '${key}' contains '___', which separates the key from the operation in the flat ` +
          "result and would make the row impossible to re-nest. Pick a name without it.",
      );
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
    // More bound parameters than the driver accepts
    tooManyParameters: [
      "too many sql variables", // SQLite, and Cloudflare D1 at 100
      "extended query has too many parameters", // PostgreSQL, at 65535
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
    // Our own error, not the driver's answer. The write paths wrap everything
    // around the statement, including the query guards that run before it, so
    // `deleteMany({ col: null })` reported "Delete query has failed" and the
    // one message that says to use `{ isNull: true }` was thrown away. A
    // `DbError` is caught by the same test and passes through for the same
    // reason: it has already been classified.
    if (error instanceof AlephaError) {
      return error as DbError;
    }

    // Before any pattern matching: drizzle demotes the driver's error to
    // `cause` and throws its own, so a timeout arrives here disguised as a
    // generic `Failed query: ...`. Classifying it by message would be
    // hopeless, and reporting it as a 500 would hide the one thing the
    // caller can act on, which is to retry later.
    const timeout = DbTimeoutError.find(error);
    if (timeout) {
      return timeout;
    }

    if (!(error instanceof Error)) {
      return new DbError(message, { cause: error });
    }

    const fullMessage =
      `${error.message} ${(error.cause as Error)?.message ?? ""}`.toLowerCase();

    const hasPattern = (patterns: string[]) =>
      patterns.some((pattern) => fullMessage.includes(pattern.toLowerCase()));

    const getSourceError = () =>
      error.cause instanceof Error ? error.cause : error;

    // Check for unique constraint violation (conflict)
    if (hasPattern(this.errorPatterns.conflict)) {
      return new DbConflictError(message, { cause: error });
    }

    // Check for foreign key violation
    if (hasPattern(this.errorPatterns.foreignKey)) {
      return this.errorParser.foreignKey(getSourceError(), this.tableName);
    }

    // Check for NOT NULL violation
    if (hasPattern(this.errorPatterns.notNull)) {
      return this.errorParser.notNull(getSourceError(), this.tableName);
    }

    // Check for deadlock
    if (hasPattern(this.errorPatterns.deadlock)) {
      return this.errorParser.deadlock(getSourceError());
    }

    // Before the column branch: D1 reports the ceiling as `too many SQL
    // variables at offset 266`, which carries no column marker today, but the
    // branch below matches a bare `column "` anywhere in the message and a
    // driver is free to quote the offending statement.
    if (hasPattern(this.errorPatterns.tooManyParameters)) {
      return this.errorParser.tooManyParameters(getSourceError());
    }

    // Column before table: on a write, postgres reports a missing column as
    // `column "x" of relation "y" does not exist`, which contains both "does
    // not exist" and "relation" and so matched the table branch — the one
    // message that names the column was reported as a missing table. No
    // table-not-found message mentions a column, so this order is safe.
    if (hasPattern(this.errorPatterns.columnNotFound)) {
      return this.errorParser.columnNotFound(getSourceError());
    }

    // Check for table not found
    if (
      hasPattern(this.errorPatterns.tableNotFound) &&
      (fullMessage.includes("relation") || fullMessage.includes("table"))
    ) {
      return this.errorParser.tableNotFound(getSourceError());
    }

    return new DbError(message, { cause: error });
  }

  /**
   * The predicate this repository adds to every read, on top of the caller's.
   *
   * Public because some relational reads do not pass through `findMany` at
   * all: the relational query builder issues one statement for a whole tree.
   * Sharing the predicate rather than reproducing it is what keeps soft delete
   * true of those statements too.
   */
  public readWhere(
    where: unknown = {},
    opts: { force?: boolean } = {},
  ): unknown {
    return this.withDeletedAt((where ?? {}) as PgQueryWhereOrSQL<T>, opts);
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

  /**
   * The entity's `db.version()` column, if it declares one.
   */
  protected versionField(): PgAttrField | undefined {
    return getAttrFields(this.entity.schema, PG_VERSION)?.[0];
  }

  /**
   * Add `version = version + 1` to an UPDATE's SET clause, on a versioned
   * entity.
   *
   * Every UPDATE the Repository issues goes through here, `save()`'s
   * included, so the optimistic lock `save()` checks is bumped by every
   * writer: a `save()` racing an `updateById` loses with a
   * {@link DbVersionMismatchError} instead of silently reverting it. Applied
   * after `cast`, which only sees plain values. Raw `query()` does not come
   * through here: a raw UPDATE on a versioned table bumps it by hand.
   */
  protected withVersionBump(set: Record<string, unknown>): void {
    const version = this.versionField();
    if (version) {
      set[version.key] = sql`${this.col(version.key as keyof Infer<T>)} + 1`;
    }
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
   *
   * @internal Driver plumbing, outside semver.
   */
  protected cast(
    data: any,
    insert: boolean,
  ): PgInsertValue<PgTableWithColumns<any>> {
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
      // An explicit `undefined` is treated exactly like an absent key. Keeping
      // it would make the update branch below re-encode the field, and for a
      // defaulted column that re-applies the default instead of leaving the
      // stored value alone.
      if (value === undefined) continue;
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
      PgTableWithColumns<any>
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
   *
   * @internal Driver plumbing, outside semver.
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
   * Whether a statement with these options runs inside a transaction: an
   * explicit `opts.tx`, or the ambient one `transactional()` set. `tx: null`
   * opts out of the ambient one.
   */
  protected inTransaction(opts: StatementOptions): boolean {
    if (opts.tx === null) {
      return false;
    }
    return (
      opts.tx !== undefined || this.alepha.get("alepha.orm.tx") !== undefined
    );
  }

  /**
   * Drop this table's cached queries after a write.
   *
   * Inside an ambient transaction the drop waits for the COMMIT
   * (`DatabaseProvider.afterCommit`), and is discarded with a rollback.
   * Dropped at write time, a concurrent reader outside the transaction could
   * re-cache the pre-commit rows in between, and they would then outlive the
   * commit. Outside a transaction it is awaited, so the write returns with the
   * cache already clean.
   *
   * An explicit `opts.tx` with no ambient transaction has no commit to hook
   * into: the drop happens now, as it always did.
   */
  protected async invalidateCache(opts: StatementOptions): Promise<void> {
    const invalidate = () => this.dbCache.invalidateTable(this.tableName);
    if (opts.tx === null) {
      await invalidate();
      return;
    }
    await this.provider.afterCommit(invalidate);
  }

  /**
   * Build a cache key from the method name, the caller's query, AND the
   * predicate this repository adds on top of it.
   *
   * The scope suffix is what makes `opts.cache` safe. Keyed on the caller's
   * query alone, a `force: true` read, which deliberately includes
   * soft-deleted rows, could poison the entry a normal read then consumed.
   * `readWhere()` includes the soft-delete envelope applied to the statement,
   * so folding it in keeps one cache entry per query and visibility scope.
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
   *
   * @internal Driver plumbing, outside semver.
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
   *
   * @internal Driver plumbing, outside semver.
   */
  protected getPrimaryKey(schema: ZObject) {
    const primaryKeys = getAttrFields(schema, PG_PRIMARY_KEY);
    if (primaryKeys.length === 0) {
      // Surface the table name and tell the dev exactly what to add.
      // Without this hint the same throw bubbles up as a generic
      // "Delete query has failed" via handleError, because deleteMany
      // resolves the PK column id at runtime via `.returning({ id })`.
      // Caught us once on `archive_names`: insert path uses
      // `.returning(this.pgTable)` (no PK touched) so creates worked
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
/**
 * Options of the update methods (`updateOne`, `updateMany`, `updateById`,
 * `save`).
 *
 * A type of its own rather than a field of {@link StatementOptions}, which
 * every read also takes: `findMany(q, { touch: false })` would compile and mean
 * nothing. `upsert` / `upsertMany` do not take it either, on purpose: their
 * conflict branch stamps `updatedAt` so a caller can tell an insert from a
 * no-op.
 */
export interface UpdateOptions extends StatementOptions {
  /**
   * Stamp the `db.updatedAt()` column. Defaults to `true`.
   *
   * `false` skips that stamp and nothing else: a `db.version()` column is
   * still bumped, events still fire and the query cache is still invalidated.
   * Use it for a write that is bookkeeping rather than an edit, which a reader
   * of `updatedAt` should not see as a change.
   *
   * With `false`, an `updatedAt` written in the patch itself is stored as
   * given, and `now` has nothing to stamp. On a table without an `updatedAt`
   * column it changes nothing.
   */
  touch?: boolean;
}

export interface StatementOptions {
  /**
   * Transaction to use.
   *
   * - `undefined` — auto-detect from `alepha.store` (implicit transactional context)
   * - a `DbTransaction` — use this specific transaction (explicit)
   * - `null` — force no transaction, bypass implicit context
   */
  tx?: DbTransaction | null;

  /**
   * Row lock taken by the SELECT (`FOR UPDATE` and its siblings). Refused
   * together with `cache`, since a cache hit takes no lock.
   */
  for?: RowLock;

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
   * A write to this table through this repository invalidates all its cached
   * queries: after the COMMIT inside a transaction, at once outside one. A
   * read inside a transaction never uses the cache.
   *
   * ⚠️ The cache is per process. A write on another instance invalidates
   * nothing here, so `ttl` is what bounds the staleness when several
   * instances run, unless `DbCacheProvider` is substituted with a shared
   * implementation. A hit is a copy: mutating it does not touch the cache.
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
