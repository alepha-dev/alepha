import { $context, $inject, AlephaError, type ZObject } from "alepha";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import { RelationalRepository } from "../services/RelationalRepository.ts";
import type { Repository } from "../services/Repository.ts";
import type { EntityPrimitive } from "./$entity.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
} from "./$relations.ts";

/**
 * Get the repository for the given entity.
 */
export function $repository<T extends ZObject>(
  entity: EntityPrimitive<T>,
): Repository<T>;

/**
 * Get a relation-aware repository for one entity of a `$relations` schema.
 *
 * Same repository, plus `include`. The entity is addressed by its key in the
 * schema rather than by the entity object, because that key is what nested
 * includes follow to find the target's own relations — a structural lookup
 * would go wrong the moment two entities happened to share a shape.
 *
 * @example
 * ```ts
 * class CampaignController {
 *   campaigns = $repository(relations, "campaigns");
 * }
 *
 * const campaign = await this.campaigns.findOne({
 *   where: { id: { eq: 1 } },
 *   include: { characters: { include: { user: true } } },
 * });
 *
 * campaign?.characters[0]?.user?.email; // fully inferred
 * ```
 */
export function $repository<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  TKey extends keyof ZType & string,
>(
  relations: RelationsPrimitive<ZType, TMap>,
  key: TKey,
): RelationalRepository<ZType, TMap, TKey>;

export function $repository(
  entityOrRelations: any,
  key?: string,
): Repository<any> | RelationalRepository<any, any, any> {
  const { alepha } = $context();
  const repositoryProvider = alepha.inject(RepositoryProvider);

  if (key !== undefined) {
    const entity = entityOrRelations.schema[key];
    if (!entity) {
      throw new AlephaError(
        `'${key}' is not in the schema passed to $relations(). Available: ${Object.keys(
          entityOrRelations.schema,
        ).join(", ")}`,
      );
    }

    // Bind the plain repository as well. Registering the entity with the
    // database provider is what puts its table in the model map, and a
    // foreign key pointing at an unregistered table fails schema build with
    // "Referenced table X not found". Going through the same path as a plain
    // binding keeps relational and non-relational entities indistinguishable
    // to everything downstream.
    $inject(repositoryProvider.createClassRepository(entity));

    return $inject(createClassRelationalRepository(entityOrRelations, key));
  }

  return $inject(repositoryProvider.createClassRepository(entityOrRelations));
}

/**
 * Alepha injects classes, not instances, so each (relations, key) pair gets a
 * named subclass whose constructor closes over both — the same trick
 * `RepositoryProvider.createClassRepository` uses for plain repositories.
 *
 * Cached so repeated `$repository(relations, "campaigns")` calls resolve to
 * one shared service rather than a new singleton per call site.
 */
const relationalRegistry = new Map<string, any>();

const createClassRelationalRepository = (
  relations: RelationsPrimitive<any, any>,
  key: string,
) => {
  const cached = relationalRegistry.get(key);
  if (cached && cached.relations === relations) {
    return cached.service;
  }

  class GenericRelationalRepository extends RelationalRepository<
    any,
    any,
    any
  > {
    constructor() {
      super(relations, key);
    }
  }

  const name = `${key.charAt(0).toUpperCase()}${key.slice(1)}RelationalRepository`;
  Object.defineProperty(GenericRelationalRepository, "name", { value: name });

  relationalRegistry.set(key, {
    relations,
    service: GenericRelationalRepository,
  });

  return GenericRelationalRepository;
};
