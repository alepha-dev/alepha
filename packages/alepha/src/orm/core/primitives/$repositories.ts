import type { RelationalRepository } from "../services/RelationalRepository.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
} from "./$relations.ts";
import { $repository } from "./$repository.ts";

/**
 * One relation-aware repository per entity, in a single binding.
 *
 * `$repository(relations, "campaigns")` is the explicit form for one entity;
 * this is the ergonomic one for a service that touches several. Plural name,
 * plural result — `$repository` always hands back exactly one repository.
 *
 * It also removes a footgun: binding every entity at once means each one is
 * registered with the database provider before any schema is built, so a
 * foreign key can never point at a table that has not been registered yet.
 * With per-entity bindings that ordering is the caller's problem.
 *
 * @example
 * ```ts
 * class CampaignService {
 *   db = $repositories(relations);
 *
 *   async members(id: number) {
 *     return await this.db.characters.findMany({
 *       where: { campaignId: { eq: id } },
 *       include: { user: true },
 *     });
 *   }
 * }
 * ```
 */
export const $repositories = <
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
>(
  relations: RelationsPrimitive<ZType, TMap>,
): Repositories<ZType, TMap> => {
  const repositories = {} as Repositories<ZType, TMap>;

  // Eager, not lazy. `$repository` reads the injection context, which only
  // exists while the surrounding class field is initialising — a Proxy that
  // deferred the binding to first access would resolve outside it.
  for (const key of Object.keys(relations.schema) as Array<
    keyof ZType & string
  >) {
    (repositories as any)[key] = $repository(relations, key);
  }

  return repositories;
};

export type Repositories<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
> = {
  [K in keyof ZType & string]: RelationalRepository<ZType, TMap, K>;
};
