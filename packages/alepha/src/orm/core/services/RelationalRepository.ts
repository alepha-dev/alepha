import { $inject, type Static, type TObject } from "alepha";
import type { OrderBy } from "../interfaces/PgQuery.ts";
import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";
import type {
  IncludeArg,
  WithIncludes,
} from "../interfaces/RelationInclude.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
} from "../primitives/$relations.ts";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import { RelationResolver } from "./RelationResolver.ts";
import type { Repository } from "./Repository.ts";

/**
 * A repository that understands declared relations.
 *
 * Wraps the plain `Repository` rather than replacing it: filtering, ordering
 * and paging are delegated untouched, and only `include` is added on top. So
 * everything already true of `Repository` stays true, and an entity with no
 * relations behaves exactly as before.
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
    const TInclude extends IncludeArg<TSchema, TMap, TKey> = {},
  >(
    query: RelationalQuery<TSchema, TMap, TKey, TInclude> = {},
  ): Promise<Array<WithIncludes<TSchema, TMap, TKey, TInclude>>> {
    const { include, ...rest } = query;

    const rows = (await this.base.findMany(rest as never)) as Array<
      Record<string, any>
    >;

    if (include && Object.keys(include).length > 0) {
      await this.resolver.resolve({
        rows,
        entityKey: this.key,
        include: include as Record<string, any>,
        schema: this.relations.schema,
        map: this.relations.map,
      });
    }

    return rows as Array<WithIncludes<TSchema, TMap, TKey, TInclude>>;
  }

  /**
   * First match, or `undefined`.
   *
   * Applies `limit: 1` to the *parent* query only — relations are still
   * resolved in full, which is the behaviour a join cannot give you without
   * either truncating children or de-duplicating parents afterwards.
   */
  public async findOne<
    const TInclude extends IncludeArg<TSchema, TMap, TKey> = {},
  >(
    query: RelationalQuery<TSchema, TMap, TKey, TInclude> = {},
  ): Promise<WithIncludes<TSchema, TMap, TKey, TInclude> | undefined> {
    const [row] = await this.findMany({ ...query, limit: 1 });
    return row;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RelationalQuery<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  TKey extends keyof TSchema & string,
  TInclude,
> {
  where?: PgQueryWhere<EntityOf<TSchema, TKey>>;
  limit?: number;
  offset?: number;
  orderBy?: OrderBy<Static<EntityOf<TSchema, TKey>>>;
  include?: TInclude;
}

type EntityOf<TSchema extends EntitySchema, TKey extends keyof TSchema> =
  TSchema[TKey] extends EntityPrimitive<infer T extends TObject> ? T : never;
