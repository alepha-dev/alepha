import {
  $inject,
  AlephaError,
  type Page,
  type PageQuery,
  type TObject,
} from "alepha";
import type {
  IncludeArg,
  RelationalQueryArgs,
  Resolve,
} from "../interfaces/RelationInclude.ts";
import type { CreateArgs } from "../interfaces/RelationWrite.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
  ResolvedRelation,
} from "../primitives/$relations.ts";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import { RelationResolver } from "./RelationResolver.ts";
import type { Repository } from "./Repository.ts";

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
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  TKey extends keyof TSchema & string,
> {
  protected readonly repositories = $inject(RepositoryProvider);
  protected readonly resolver = $inject(RelationResolver);

  constructor(
    public readonly relations: RelationsPrimitive<TSchema, TMap>,
    public readonly key: TKey,
  ) {}

  /** The entity this repository is bound to. */
  public get entity(): EntityPrimitive<EntityOf<TSchema, TKey>> {
    return this.relations.schema[this.key] as EntityPrimitive<
      EntityOf<TSchema, TKey>
    >;
  }

  /**
   * The underlying relation-unaware repository, fully typed. Every existing
   * escape hatch — `create`, `upsert`, `aggregate`, raw `query` — still works.
   */
  public get base(): Repository<EntityOf<TSchema, TKey>> {
    return this.repositories.getRepository(this.entity);
  }

  public async findMany<
    const TArgs extends RelationalQueryArgs<TSchema, TMap, TKey> = {},
  >(
    query: TArgs = {} as TArgs,
  ): Promise<Array<Resolve<TSchema, TMap, TKey, TArgs>>> {
    const carried = this.carriedColumns(query);

    const rows = (await this.base.findMany(
      this.toBaseQuery(query, carried) as never,
    )) as Array<Record<string, any>>;

    await this.applyIncludes(rows, query);
    this.dropCarried(rows, carried);

    return rows as Array<Resolve<TSchema, TMap, TKey, TArgs>>;
  }

  /**
   * First match, or `undefined`.
   *
   * `limit: 1` applies to the *parent* only — relations are still resolved in
   * full, which is what a join cannot do without either truncating children or
   * de-duplicating parents afterwards.
   */
  public async findOne<
    const TArgs extends RelationalQueryArgs<TSchema, TMap, TKey> = {},
  >(
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<TSchema, TMap, TKey, TArgs> | undefined> {
    const [row] = await this.findMany({ ...query, limit: 1 } as TArgs);
    return row;
  }

  /** First match, or throw. */
  public async getOne<
    const TArgs extends RelationalQueryArgs<TSchema, TMap, TKey> = {},
  >(query: TArgs = {} as TArgs): Promise<Resolve<TSchema, TMap, TKey, TArgs>> {
    const row = await this.findOne(query);
    if (!row) {
      throw new AlephaError(`No '${this.key}' matched the given query.`);
    }
    return row;
  }

  public async findById<
    const TArgs extends Omit<
      RelationalQueryArgs<TSchema, TMap, TKey>,
      "where" | "limit" | "offset"
    > = {},
  >(
    id: string | number,
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<TSchema, TMap, TKey, TArgs> | undefined> {
    const primaryKey = this.base.id.key as string;
    return (await this.findOne({
      ...(query as object),
      where: { [primaryKey]: { eq: id } },
    } as never)) as Resolve<TSchema, TMap, TKey, TArgs> | undefined;
  }

  public async getById<
    const TArgs extends Omit<
      RelationalQueryArgs<TSchema, TMap, TKey>,
      "where" | "limit" | "offset"
    > = {},
  >(
    id: string | number,
    query: TArgs = {} as TArgs,
  ): Promise<Resolve<TSchema, TMap, TKey, TArgs>> {
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
    const TArgs extends RelationalQueryArgs<TSchema, TMap, TKey> = {},
  >(
    pagination: PageQuery = {},
    query: TArgs = {} as TArgs,
    options: { count?: boolean } = {},
  ): Promise<Page<Resolve<TSchema, TMap, TKey, TArgs>>> {
    const carried = this.carriedColumns(query);

    const page = await this.base.paginate(
      pagination,
      this.toBaseQuery(query, carried) as never,
      options,
    );

    const rows = page.content as Array<Record<string, any>>;
    await this.applyIncludes(rows, query);
    this.dropCarried(rows, carried);

    return page as Page<Resolve<TSchema, TMap, TKey, TArgs>>;
  }

  /** Row count for a filter. Relations are irrelevant here, so none are run. */
  public async count(
    query: Pick<RelationalQueryArgs<TSchema, TMap, TKey>, "where"> = {},
  ): Promise<number> {
    return await this.base.count(query.where as never);
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
   */
  public async create<const TArgs extends CreateArgs<TSchema, TMap, TKey>>(
    args: TArgs,
  ): Promise<
    Resolve<
      TSchema,
      TMap,
      TKey,
      TArgs extends { include: infer I } ? { include: I } : {}
    >
  > {
    return (await this.base.transaction(async () => {
      const row = await this.createDeep(this.key, args.data as CreateInput);

      if (!args.include) {
        return row;
      }

      const id = row[this.base.id.key as string];
      return await this.getById(id, { include: args.include } as never);
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
   * Translate the relational query into the plain repository's vocabulary.
   * `select` becomes `columns`; `include` is handled separately.
   */
  protected toBaseQuery(
    query: RelationalQueryArgs<TSchema, TMap, TKey>,
    carried: string[] = [],
  ) {
    const { include: _include, select, ...rest } = query as Record<string, any>;
    if (!select) return rest;
    return { ...rest, columns: [...select, ...carried] };
  }

  /**
   * Columns a `select` left out but an `include` still needs.
   *
   * A relation is looked up by the owning row's `from` column, so projecting
   * it away leaves nothing to match on and every relation silently resolves
   * to undefined. They are fetched anyway and removed afterwards, so the
   * result still matches the type the caller was given.
   */
  protected carriedColumns(
    query: RelationalQueryArgs<TSchema, TMap, TKey>,
  ): string[] {
    const select = query.select as ReadonlyArray<string> | undefined;
    const include = query.include as Record<string, unknown> | undefined;
    if (!select || !include) return [];

    const declared = (this.relations.map as any)[this.key] as
      | Record<string, ResolvedRelation>
      | undefined;

    const needed = new Set<string>();
    for (const name of Object.keys(include)) {
      if (!include[name]) continue;
      const from = declared?.[name]?.from;
      if (from && !select.includes(from)) needed.add(from);
    }

    return [...needed];
  }

  protected dropCarried(
    rows: Array<Record<string, any>>,
    carried: string[],
  ): void {
    if (carried.length === 0) return;
    for (const row of rows) {
      for (const column of carried) delete row[column];
    }
  }

  protected async applyIncludes(
    rows: Array<Record<string, any>>,
    query: RelationalQueryArgs<TSchema, TMap, TKey>,
  ): Promise<void> {
    const include = query.include as Record<string, any> | undefined;
    if (!include || Object.keys(include).length === 0) return;

    await this.resolver.resolve({
      rows,
      entityKey: this.key,
      include,
      schema: this.relations.schema,
      map: this.relations.map,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type EntityOf<TSchema extends EntitySchema, TKey extends keyof TSchema> =
  TSchema[TKey] extends EntityPrimitive<infer T extends TObject> ? T : never;

/** Kept for callers that referenced the previous name. */
export type RelationalQuery<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  TKey extends keyof TSchema & string,
  TInclude,
> = RelationalQueryArgs<TSchema, TMap, TKey> & { include?: TInclude };

export type { IncludeArg };

/**
 * Untyped view of nested create data, used inside the recursion where the
 * entity varies per level and the static shape no longer applies.
 */
type CreateInput = Record<string, any>;
