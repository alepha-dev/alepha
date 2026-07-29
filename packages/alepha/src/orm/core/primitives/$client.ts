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
 * `$repository(relations, "campaigns")` is the explicit form; this is the
 * ergonomic one for a service that touches several entities.
 *
 * It also removes a footgun: binding every entity at once means each one is
 * registered with the database provider before any schema is built, so a
 * foreign key can never point at a table that has not been registered yet.
 * With per-entity bindings that ordering is the caller's problem.
 *
 * @example
 * ```ts
 * class CampaignService {
 *   db = $client(relations);
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
export const $client = <
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
>(
  relations: RelationsPrimitive<TSchema, TMap>,
): Client<TSchema, TMap> => {
  const client = {} as Client<TSchema, TMap>;

  // Eager, not lazy. `$repository` reads the injection context, which only
  // exists while the surrounding class field is initialising — a Proxy that
  // deferred the binding to first access would resolve outside it.
  for (const key of Object.keys(relations.schema) as Array<
    keyof TSchema & string
  >) {
    (client as any)[key] = $repository(relations, key);
  }

  return client;
};

export type Client<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
> = {
  [K in keyof TSchema & string]: RelationalRepository<TSchema, TMap, K>;
};
