import { $context, $inject, type TObject } from "@alepha/core";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import type { Repository } from "../services/Repository.ts";
import type { EntityDescriptor } from "./$entity.ts";

/**
 * Get the repository for the given entity.
 */
export const $repository = <T extends TObject>(
  entity: EntityDescriptor<T>,
): Repository<T> => {
  const { alepha } = $context();
  const repositoryProvider = alepha.inject(RepositoryProvider);
  return $inject(repositoryProvider.createClassRepository(entity));
};
