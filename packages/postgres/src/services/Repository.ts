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
} from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import { asc, desc, isSQLWrapper, type SQL } from "drizzle-orm";
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
import type {
  EntityDescriptor,
  SchemaToTableConfig,
} from "../descriptors/$entity.ts";
import { DbError } from "../errors/DbError.ts";
import { PgConflictError } from "../errors/PgConflictError.ts";
import { PgEntityNotFoundError } from "../errors/PgEntityNotFoundError.ts";
import { PgVersionMismatchError } from "../errors/PgVersionMismatchError.ts";
import { getAttrFields, type PgAttrField } from "../helpers/pgAttr.ts";
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
  DatabaseProvider,
  type SQLLike,
} from "../providers/drivers/DatabaseProvider.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { TObjectUpdate } from "../schemas/updateSchema.ts";
import { PgRelationManager } from "./PgRelationManager.ts";
import { type PgJoin, QueryManager } from "./QueryManager.ts";

export abstract class Repository<T extends TObject> {
  public readonly entity: EntityDescriptor<T>;
  public readonly provider: DatabaseProvider;

  protected readonly relationManager = $inject(PgRelationManager);
  protected readonly queryManager = $inject(QueryManager);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  constructor(entity: EntityDescriptor<T>, provider = DatabaseProvider) {
    this.entity = entity;
    this.provider = this.alepha.inject(provider);
    this.provider.registerEntity(entity as EntityDescriptor);
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
   * Getter for the database connection from the database provider.
   */
  protected get db(): PgDatabase<any> {
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

    const rows = await this.provider.execute(raw);

    return rows.map((it) => {
      return this.clean(
        this.mapRawFieldsToEntity(it),
        schema ?? this.entity.schema,
      ) as Static<R>;
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
  protected col(name: keyof StaticEncode<T>): PgColumn {
    const column = (this.table as any)[name];
    if (!column) {
      throw new AlephaError(
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
    columns: (keyof Static<T>)[] = [],
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
  public async find<R extends PgRelationMap<T>>(
    query: PgQueryRelations<T, R> = {},
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R>[]> {
    await this.alepha.events.emit("repository:read:before", {
      tableName: this.tableName,
      query,
    });

    const columns = query.columns ?? query.distinct;
    const builder = query.distinct
      ? this.selectDistinct(opts, query.distinct)
      : this.select(opts);

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

      return rows as PgStatic<T, R>[];
    } catch (error) {
      throw new DbError("Query select has failed", error as Error);
    }
  }

  /**
   * Find a single entity.
   */
  public async findOne<R extends PgRelationMap<T>>(
    query: Pick<PgQueryRelations<T, R>, "with" | "where">,
    opts: StatementOptions = {},
  ): Promise<PgStatic<T, R>> {
    const [entity] = await this.find({ limit: 1, ...query }, opts);

    if (!entity) {
      // TODO: enhance error message when finding by ID
      throw new PgEntityNotFoundError(this.tableName);
    }

    return entity as PgStatic<T, R>;
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
    query: PgQueryRelations<T, R> = {},
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
   * Find an entity by ID.
   *
   * This is a convenience method for `findOne` with a where clause on the primary key.
   * If you need more complex queries, use `findOne` instead.
   */
  public async findById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
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
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });

    try {
      const entity = await this.insert(opts)
        .values(this.cast(data ?? {}, true))
        .returning(this.table)
        .then(([it]) => this.clean(it, this.entity.schema));

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
   * @param values The entities to create.
   * @param opts The statement options.
   * @returns The created entities.
   */
  public async createMany(
    values: Array<Static<TObjectInsert<T>>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>[]> {
    if (values.length === 0) {
      return [];
    }

    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data: values,
    });

    try {
      const entities = await this.insert(opts)
        .values(values.map((data) => this.cast(data, true)))
        .returning(this.table)
        .then((rows) => rows.map((it) => this.clean(it, this.entity.schema)));

      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data: values,
        entity: entities,
      });

      return entities;
    } catch (error) {
      throw this.handleError(error, "Insert query has failed");
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find an entity and update it.
   */
  public async updateOne(
    where: PgQueryWhereOrSQL<T>,
    data: Partial<Static<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
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
      row[updatedAtField.key] = this.dateTimeProvider
        .of(opts.now)
        .toISOString();
    }

    where = this.withDeletedAt(where, opts);
    row = this.cast(row, false) as any;

    // do not update the ID field
    delete row[this.id.key];

    const response = await this.update(opts)
      .set(row)
      .where(this.toSQL(where))
      .returning(this.table)
      .catch((error) => {
        throw this.handleError(error, "Update query has failed");
      });

    if (!response[0]) {
      throw new PgEntityNotFoundError(this.tableName);
    }

    try {
      const entity = this.clean(response[0], this.entity.schema);

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
   * @see {@link PgVersionMismatchError}
   */
  public async save(
    entity: Static<T>,
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
    for (const key of Object.keys(this.entity.schema.properties)) {
      if (row[key] === undefined) {
        row[key] = null;
      }
    }

    let where: any = this.createQueryWhere();

    where.id = { eq: id };

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
      if (error instanceof PgEntityNotFoundError && versionField) {
        // Verify entity still exists to differentiate between not-found vs version mismatch
        // If findById succeeds, entity exists and this was a version mismatch
        // If findById throws, entity doesn't exist and we let that error propagate
        await this.findById(id);
        throw new PgVersionMismatchError(this.tableName, id);
      }
      throw error;
    }
  }

  /**
   * Find an entity by ID and update it.
   */
  public async updateById(
    id: string | number,
    data: Partial<Static<TObjectUpdate<T>>>,
    opts: StatementOptions = {},
  ): Promise<Static<T>> {
    return await this.updateOne(this.getWhereId(id), data, opts);
  }

  /**
   * Find many entities and update all of them.
   */
  public async updateMany(
    where: PgQueryWhereOrSQL<T>,
    data: Partial<Static<TObjectUpdate<T>>>,
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
      (data as any)[updatedAtField.key] = this.dateTimeProvider
        .of(opts.now)
        .toISOString();
    }

    where = this.withDeletedAt(where, opts);
    data = this.cast(data, false) as any;
    try {
      const entities = await this.update(opts)
        .set(
          data as PgUpdateSetSource<PgTableWithColumns<SchemaToTableConfig<T>>>,
        )
        .where(this.toSQL(where))
        .returning();

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
      const result = await this.delete(opts)
        .where(this.toSQL(where))
        .returning({ id: (this.table as any)[this.id.key] });
      const ids = result.map((row) => row.id);

      await this.alepha.events.emit("repository:delete:after", {
        tableName: this.tableName,
        where,
        ids,
      });

      return ids;
    } catch (error) {
      throw new DbError("Delete query has failed", error as Error);
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
    return await this.deleteMany(where, opts);
  }

  /**
   * Find an entity by ID and delete it.
   * @returns Array containing the deleted entity ID
   * @throws PgEntityNotFoundError if the entity is not found
   */
  public async deleteById(
    id: string | number,
    opts: StatementOptions = {},
  ): Promise<Array<number | string>> {
    const result = await this.deleteMany(this.getWhereId(id), opts);
    if (result.length === 0) {
      throw new PgEntityNotFoundError(
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
    return (opts.tx ?? this.db).$count(this.table, this.toSQL(where));
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected conflictMessagePattern =
    "duplicate key value violates unique constraint";

  protected handleError(error: unknown, message: string): DbError {
    if (!(error instanceof Error)) {
      return new DbError(message);
    }

    if (
      (error.cause as Error)?.message.includes(this.conflictMessagePattern) ||
      error.message.includes(this.conflictMessagePattern)
    ) {
      return new PgConflictError(message, error);
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
  now?: DateTime | string;
}
