import { $context, $inject, type TObject } from "alepha";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import type { Repository } from "../services/Repository.ts";
import type { EntityPrimitive } from "./$entity.ts";

/**
 * Get the repository for the given entity.
 */
export const $repository = <T extends TObject>(
  entity: EntityPrimitive<T>,
): Repository<T> => {
  const { alepha } = $context();
  const repositoryProvider = alepha.inject(RepositoryProvider);
  return $inject(repositoryProvider.createClassRepository(entity));
};
