import {
  $inject,
  AlephaError,
  createPagination,
  type Page,
  type PageQuery,
  type ZObject,
} from "alepha";
import type {
  IncludeArg,
  RelationalQueryArgs,
  Resolve,
} from "../interfaces/RelationInclude.ts";
import type {
  CreateArgs,
  CreateManyArgs,
  DeleteArgs,
  UpdateArgs,
  UpdateManyArgs,
  UpdateOf,
  UpsertArgs,
} from "../interfaces/RelationWrite.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
  ResolvedRelation,
  RowOf,
} from "../primitives/$relations.ts";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import { QueryManager } from "./QueryManager.ts";
import type { Repository } from "./Repository.ts";
import { RqbExecutor } from "./RqbExecutor.ts";

/**
 * A repository that understands declared relations.
 *
 * Wraps the plain `Repository` rather than replacing it: filtering, ordering
 * and paging are delegated untouched, and `include` / `select` are layered on
 * top. Everything already true of `Repository` stays true, and an entity with
 * no relations behaves exactly as before.
 *
 * `create` additionally understands nested writes. Every other write —
 * `upsert`, `updateOne`, `deleteMany` — is reached through `.base`, which is
 * fully typed; there is no value in re-exporting operations that relations do
 * not change.
 */
export class RelationalRepository<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  TKey extends keyof ZType & string,
> {
  protected readonly repositories = $inject(RepositoryProvider);
  protected readonly rqb = $inject(RqbExecutor);
  protected readonly queryManager = $inject(QueryManager);

  constructor(
    public readonly relations: RelationsPrimitive<ZType, TMap>,
    public readonly key: TKey,
  ) {}

  /** The entity this repository is bound to. */
  public get entity(): EntityPrimitive<EntityOf<ZType, TKey>> {
    return this.relations.schema[this.key] as EntityPrimitive<
      EntityOf<ZType, TKey>
    >;
  }

  /**
   * The underlying relation-unaware repository, fully typed. Every existing
   * escape hatch — `create`, `upsert`, `aggregate`, raw `query` — still works.
   */
  public get base(): Repository<EntityOf<ZType, TKey>> {
    return this.repositories.getRepository(this.entity);
  }

  public async findMany<
    const TArgs extends RelationalQueryArgs<ZType, TMap, TKey> = {},
  >(
    query: TArgs = {} as TArgs,
  ): Promise<Array<Resolve<ZType, TMap, TKey, TArgs>>> {
    return (await this.rows(query)) as Array<Resolve<ZType, TMap, TKey, TArgs>>;
  }

  /**
   * First match, or `undefined`.
   *
   * `limit: 1` applies to the *parent* only — relations are still resolved in
   * full, which is what a join cannot do without either truncating children or
   * de-duplicating parents afterwards.
   */
  public async findOne<
    const TArgs extends RelationalQueryArgs<ZType, TMap, TKey> = {},
  >(
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs> | undefined> {
    const [row] = await this.findMany({ ...query, limit: 1 } as TArgs);
    return row;
  }

  /** First match, or throw. */
  public async getOne<
    const TArgs extends RelationalQueryArgs<ZType, TMap, TKey> = {},
  >(query: TArgs = {} as TArgs): Promise<Resolve<ZType, TMap, TKey, TArgs>> {
    const row = await this.findOne(query);
    if (!row) {
      throw new AlephaError(`No '${this.key}' matched the given query.`);
    }
    return row;
  }

  public async findById<
    const TArgs extends Omit<
      RelationalQueryArgs<ZType, TMap, TKey>,
      "where" | "limit" | "offset"
    > = {},
  >(
    id: string | number,
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs> | undefined> {
    const primaryKey = this.base.id.key as string;
    return (await this.findOne({
      ...(query as object),
      where: { [primaryKey]: { eq: id } },
    } as never)) as Resolve<ZType, TMap, TKey, TArgs> | undefined;
  }

  public async getById<
    const TArgs extends Omit<
      RelationalQueryArgs<ZType, TMap, TKey>,
      "where" | "limit" | "offset"
    > = {},
  >(
    id: string | number,
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs>> {
    const row = await this.findById(id, query);
    if (!row) {
      throw new AlephaError(`No '${this.key}' with id '${id}'.`);
    }
    return row;
  }

  /**
   * A page of rows, with relations resolved for that page only.
   *
   * Resolving after paging is the point: the relation queries key off the
   * rows actually returned, so page size bounds the work rather than table
   * size.
   */
  public async paginate<
    const TArgs extends RelationalQueryArgs<ZType, TMap, TKey> = {},
  >(
    pagination: PageQuery = {},
    query: TArgs = {} as TArgs,
    options: { count?: boolean } = {},
  ): Promise<Page<Resolve<ZType, TMap, TKey, TArgs>>> {
    if (!this.delegates(query)) {
      const page = await this.base.paginate(
        pagination,
        this.toBaseQuery(query) as never,
        { ...options, ...this.toBaseOptions(query) },
      );

      return page as Page<Resolve<ZType, TMap, TKey, TArgs>>;
    }

    const args = query as Record<string, any>;
    const limit = args.limit ?? pagination.size ?? 10;
    const offset = args.offset ?? (pagination.page ?? 0) * limit;
    const orderBy =
      args.orderBy ??
      (pagination.sort
        ? this.queryManager.parsePaginationSort(pagination.sort)
        : undefined);

    const [rows, total] = await Promise.all([
      this.rows({
        ...args,
        orderBy,
        offset,
        // one extra row is the next-page sentinel `createPagination` looks for
        limit: limit + 1,
      } as TArgs),
      options.count
        ? (this.assertCountable(args.where),
          this.base.count(args.where as never, this.toBaseOptions(query)))
        : undefined,
    ]);

    const page = createPagination(
      rows,
      limit,
      offset,
      orderBy ? this.queryManager.normalizeOrderBy(orderBy) : undefined,
    );

    page.page.totalElements = total;
    if (total != null) {
      page.page.totalPages = Math.ceil(total / limit);
    }

    return page as Page<Resolve<ZType, TMap, TKey, TArgs>>;
  }

  /**
   * Row count for a filter.
   *
   * No relations are resolved — a count does not need them. A filter that
   * *names* one is refused rather than silently counted without it: the
   * relational engine has no `count`, so the predicate cannot be pushed into
   * a `COUNT(*)` without rebuilding the `EXISTS` by hand.
   */
  public async count(
    query: Pick<RelationalQueryArgs<ZType, TMap, TKey>, "where"> = {},
  ): Promise<number> {
    this.assertCountable(query.where);
    return await this.base.count(query.where as never);
  }

  protected assertCountable(where: unknown): void {
    if (!this.namesRelation(where)) return;

    throw new AlephaError(
      `Counting '${this.key}' with a filter on a relation is not supported — the count would silently ignore it. Filter on columns, or count the rows a findMany returns.`,
    );
  }

  // --- writes ---------------------------------------------------------------
  //
  // Shaped as a single options object, matching the read side. That symmetry
  // is the point: `where` always means the same thing, and `include` /
  // `select` work on a written row exactly as on a read one — which the
  // positional form had no room for.

  /** Insert many rows. Relations are not nested here; use `create` per row. */
  public async createMany<
    const TArgs extends CreateManyArgs<ZType, TMap, TKey>,
  >(args: TArgs): Promise<Array<RowOf<ZType, TKey>>> {
    return (await this.base.createMany(args.data as never)) as never;
  }

  /**
   * Update the first row matching `where`.
   *
   * `where` is mandatory — an optional filter here would let a forgotten
   * clause rewrite the whole table.
   */
  public async update<const TArgs extends UpdateArgs<ZType, TMap, TKey>>(
    args: TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs>> {
    const row = (await this.base.updateOne(
      args.where as never,
      args.data as never,
    )) as Record<string, any>;

    return (await this.reread(row, args)) as never;
  }

  /** Update by primary key. Sugar for the common case. */
  public async updateById(
    id: string | number,
    data: UpdateOf<ZType, TKey>,
  ): Promise<RowOf<ZType, TKey>> {
    return (await this.base.updateById(id, data as never)) as never;
  }

  /** Update every row matching `where`. Returns the affected ids. */
  public async updateMany(
    args: UpdateManyArgs<ZType, TKey>,
  ): Promise<Array<number | string>> {
    return await this.base.updateMany(args.where as never, args.data as never);
  }

  /**
   * Insert, or update when the conflict target already exists.
   *
   * Omitting `update` does *not* skip the write: the underlying statement
   * still sets the columns from `create`, so the row ends up with the values
   * you passed either way. That is idempotent, which is usually what a toggle
   * wants — but it is a write, not a no-op, and it bumps `updatedAt`.
   *
   * `target` needs a matching unique constraint. Without one there is nothing
   * for ON CONFLICT to match and the statement fails at the database.
   */
  public async upsert<const TArgs extends UpsertArgs<ZType, TMap, TKey>>(
    args: TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs>> {
    const row = (await this.base.upsert(args.create as never, {
      target: args.target as never,
      set: args.update as never,
    })) as Record<string, any>;

    return (await this.reread(row, args)) as never;
  }

  /**
   * Replace a whole row, honouring optimistic locking when the entity has a
   * version column.
   *
   * Kept positional deliberately: it is a read-modify-write over an entity you
   * already hold, not a query, so an options object would be dressing.
   */
  public async save(entity: RowOf<ZType, TKey>): Promise<void> {
    await this.base.save(entity as never);
  }

  /** Delete the first row matching `where`. Returns the affected ids. */
  public async delete(
    args: DeleteArgs<ZType, TKey>,
  ): Promise<Array<number | string>> {
    return await this.base.deleteOne(args.where as never, {
      force: args.force,
    });
  }

  /** Delete by primary key. */
  public async deleteById(
    id: string | number,
    options: { force?: boolean } = {},
  ): Promise<Array<number | string>> {
    return await this.base.deleteById(id, options);
  }

  /** Delete every row matching `where`. */
  public async deleteMany(
    args: DeleteArgs<ZType, TKey>,
  ): Promise<Array<number | string>> {
    return await this.base.deleteMany(args.where as never, {
      force: args.force,
    });
  }

  // --- escape hatches -------------------------------------------------------

  /** The drizzle table, for raw SQL. */
  public get table() {
    return this.base.table;
  }

  /** The primary key's name, type and column. */
  public get id() {
    return this.base.id;
  }

  public get tableName(): string {
    return this.base.tableName;
  }

  /** Raw SQL, typed by an optional result schema. */
  public query(
    ...args: Parameters<Repository<EntityOf<ZType, TKey>>["query"]>
  ) {
    return this.base.query(...args);
  }

  /**
   * The statement a read would issue, without running it.
   *
   * Worth having because a relational read no longer looks like the query you
   * wrote: the whole tree compiles to one statement, and this is how you get
   * it in front of `EXPLAIN`. Relation-free queries have no such gap, so they
   * are refused here rather than answered from a different code path.
   */
  public toSQL(query: RelationalQueryArgs<ZType, TMap, TKey>): {
    sql: string;
    params: Array<unknown>;
  } {
    if (!this.delegates(query)) {
      throw new AlephaError(
        `toSQL() on '${this.key}' needs a query with relations — without them the read goes through the plain repository.`,
      );
    }

    return this.rqb.toSQL({
      relations: this.relations as never,
      entityKey: this.key,
      provider: this.base.provider,
      query: query as never,
    });
  }

  /** Grouped aggregates. */
  public aggregate(
    ...args: Parameters<Repository<EntityOf<ZType, TKey>>["aggregate"]>
  ) {
    return this.base.aggregate(...args);
  }

  /** Run a callback inside a transaction. */
  public transaction<R>(fn: (tx: any) => Promise<R>): Promise<R> {
    return this.base.transaction(fn as never) as Promise<R>;
  }

  /**
   * Re-read a written row when the caller asked for relations or a projection.
   *
   * Writes return the plain row, so anything richer needs a second read. It is
   * skipped entirely when neither was requested.
   */
  protected async reread(
    row: Record<string, any>,
    args: { include?: unknown; select?: unknown },
  ): Promise<unknown> {
    if (!args.include && !args.select) return row;

    return await this.getById(row[this.base.id.key as string], {
      include: args.include,
      select: args.select,
    } as never);
  }

  /**
   * Create a row, optionally creating related rows in the same transaction.
   *
   * Ordering is forced by where each foreign key lives, and the two directions
   * are opposites:
   *
   * - a **to-one** related row is created *first*, because this row's foreign
   *   key points at it and is not known until it exists;
   * - a **to-many** child is created *after*, because its foreign key points
   *   back here.
   *
   * Everything runs inside one transaction, so a failure part-way through
   * leaves no half-built graph behind.
   *
   * Opened through the *provider* rather than `base.transaction()`, which
   * hands its callback drizzle's transaction handle but leaves the ambient
   * marker unset — so repositories inside it keep writing on pooled
   * connections, outside the `BEGIN`. Every write here goes through a
   * repository, so that distinction is the whole difference between atomic
   * and not.
   */
  public async create<const TArgs extends CreateArgs<ZType, TMap, TKey>>(
    args: TArgs,
  ): Promise<Resolve<ZType, TMap, TKey, TArgs>> {
    return (await this.base.provider.transactional(async () => {
      const row = await this.createDeep(this.key, args.data as CreateInput);
      return await this.reread(row, args);
    })) as never;
  }

  /**
   * Create one row and everything nested under it. Recurses, so a graph
   * several levels deep is built in dependency order.
   */
  protected async createDeep(
    entityKey: string,
    data: CreateInput,
  ): Promise<Record<string, any>> {
    const declared = (this.relations.map as any)[entityKey] as
      | Record<string, ResolvedRelation>
      | undefined;

    const scalars: Record<string, any> = {};
    const toMany: Array<[ResolvedRelation, CreateInput[]]> = [];

    for (const [field, value] of Object.entries(data)) {
      const relation = declared?.[field];

      if (!relation) {
        scalars[field] = value;
        continue;
      }

      const nested = (value as { create?: unknown })?.create;
      if (nested === undefined) continue;

      if (relation.kind === "one") {
        // Must exist before this row, because this row's FK points at it.
        const related = await this.createDeep(
          relation.target,
          nested as CreateInput,
        );
        scalars[relation.from] = related[relation.to];
      } else {
        toMany.push([
          relation,
          (Array.isArray(nested) ? nested : [nested]) as CreateInput[],
        ]);
      }
    }

    const entity = this.relations.schema[entityKey];
    if (!entity) {
      throw new AlephaError(
        `'${entityKey}' is not in the schema passed to $relations().`,
      );
    }

    const row = (await this.repositories
      .getRepository(entity)
      .create(scalars as never)) as Record<string, any>;

    for (const [relation, items] of toMany) {
      for (const item of items) {
        // The child's link column is filled from the parent, so a value passed
        // for it would be silently overridden — the type omits it for exactly
        // that reason.
        await this.createDeep(relation.target, {
          ...item,
          [relation.to]: row[relation.from],
        });
      }
    }

    return row;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The rows for a query, however they are best fetched.
   *
   * With relations to resolve, this goes to Drizzle's relational query builder
   * and the whole tree arrives in one statement. Without them there is nothing
   * to gain and something to lose — caching, `groupBy`, `distinct`, row locks
   * all live on the plain repository — so a relation-free query stays exactly
   * the read it was before relations existed.
   */
  protected async rows(
    query: RelationalQueryArgs<ZType, TMap, TKey>,
  ): Promise<Array<Record<string, any>>> {
    if (this.delegates(query)) {
      return await this.rqb.findMany({
        relations: this.relations as never,
        entityKey: this.key,
        provider: this.base.provider,
        query: query as never,
      });
    }

    return (await this.base.findMany(
      this.toBaseQuery(query) as never,
      this.toBaseOptions(query),
    )) as Array<Record<string, any>>;
  }

  /**
   * Whether this query goes to the relational query builder.
   *
   * An `include` is the obvious case. A `where` that names a relation is the
   * other one, and it is easy to miss: without this the query would fall to
   * the plain repository, which knows nothing about relations and would
   * report the relation name as an unknown column.
   */
  protected delegates(query: RelationalQueryArgs<ZType, TMap, TKey>): boolean {
    const include = query.include as Record<string, unknown> | undefined;
    if (include && Object.keys(include).length > 0) return true;

    return this.namesRelation(query.where);
  }

  /**
   * Whether a where mentions a declared relation anywhere, including inside
   * `and` / `or` / `not`.
   *
   * The buried case is not supported, but it has to be *detected* here — left
   * to the plain repository it would surface as "unknown column 'author'",
   * which says nothing about why. Routing it to the relational path lets the
   * translation explain itself.
   */
  protected namesRelation(node: unknown): boolean {
    const declared = (this.relations.map as any)[this.key] as
      | Record<string, unknown>
      | undefined;
    if (!declared) return false;

    const walk = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(walk);
      if (typeof value !== "object" || value === null) return false;

      return Object.entries(value).some(([key, child]) =>
        declared[key]
          ? true
          : (key === "and" || key === "or" || key === "not") && walk(child),
      );
    };

    return walk(node);
  }

  /**
   * Translate the relational query into the plain repository's vocabulary.
   * `select` becomes `columns`; `include` is handled separately.
   */
  protected toBaseQuery(query: RelationalQueryArgs<ZType, TMap, TKey>) {
    const {
      include: _include,
      force: _force,
      select,
      ...rest
    } = query as Record<string, any>;
    if (!select) return rest;
    return { ...rest, columns: select };
  }

  /**
   * `force` is a statement option on the plain repository rather than part of
   * the query, so it is peeled back off on the way down.
   */
  protected toBaseOptions(query: RelationalQueryArgs<ZType, TMap, TKey>) {
    return { force: (query as { force?: boolean }).force };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type EntityOf<ZType extends EntitySchema, TKey extends keyof ZType> =
  ZType[TKey] extends EntityPrimitive<infer T extends ZObject> ? T : never;

/** Kept for callers that referenced the previous name. */
export type RelationalQuery<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  TKey extends keyof ZType & string,
  TInclude,
> = RelationalQueryArgs<ZType, TMap, TKey> & { include?: TInclude };

export type { IncludeArg };

/**
 * Untyped view of nested create data, used inside the recursion where the
 * entity varies per level and the static shape no longer applies.
 */
type CreateInput = Record<string, any>;
