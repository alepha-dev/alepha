import { $context, $inject, type TObject } from "alepha";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import type { Repository } from "../services/Repository.ts";
import type { EntityPrimitive } from "./$entity.ts";
import type { ViewPrimitive } from "./$view.ts";

/**
 * Get the repository for the given entity or view.
 */
export const $repository = <T extends TObject>(
  entity: EntityPrimitive<T> | ViewPrimitive<T>,
): Repository<T> => {
  const { alepha } = $context();
  const repositoryProvider = alepha.inject(RepositoryProvider);
  return $inject(
    repositoryProvider.createClassRepository(entity as EntityPrimitive<T>),
  );
};
