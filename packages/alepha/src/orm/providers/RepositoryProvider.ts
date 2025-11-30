import { $inject, Alepha, type Service, type TObject } from "alepha";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import { Repository } from "../services/Repository.ts";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

export class RepositoryProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly registry = new Map<
    EntityPrimitive<any>,
    Service<Repository<any>>
  >();

  public getRepositories(provider?: DatabaseProvider) {
    const repositories = this.alepha.services(Repository);

    if (provider) {
      return repositories.filter((it) => it.provider === provider);
    }

    return repositories;
  }

  public getRepository<T extends TObject>(
    entity: EntityPrimitive<T>,
  ): Repository<T> {
    const RepositoryClass = this.createClassRepository(entity);
    return this.alepha.inject(RepositoryClass);
  }

  public createClassRepository<T extends TObject>(
    entity: EntityPrimitive<T>,
  ): Service<Repository<T>> {
    let name = entity.name.charAt(0).toUpperCase() + entity.name.slice(1);
    if (name.endsWith("s")) {
      name = name.slice(0, -1);
    }
    name = `${name}Repository`;

    if (this.registry.has(entity)) {
      return this.registry.get(entity) as Service<Repository<T>>;
    }

    class GenericRepository extends Repository<T> {
      constructor() {
        super(entity);
      }
    }

    // for class name to entity.name + "Repository"
    Object.defineProperty(GenericRepository, "name", { value: name });

    this.registry.set(entity, GenericRepository as Service<Repository<T>>);

    return GenericRepository;
  }
}
