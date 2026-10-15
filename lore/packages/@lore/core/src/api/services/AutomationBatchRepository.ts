import { type Infer, type ZObject } from "alepha";
import { type EntityPrimitive, Repository } from "alepha/orm";

/**
 * Decodes native batch RETURNING rows using the same driver columns and entity
 * cleanup as an ordinary repository, without another database round trip.
 */
export class AutomationBatchRepository<
  T extends ZObject,
> extends Repository<T> {
  protected static readonly batchRepositories = new WeakMap<
    EntityPrimitive<any>,
    unknown
  >();
  public static override of<S extends ZObject>(
    entity: EntityPrimitive<S>,
  ): new () => AutomationBatchRepository<S> {
    const cached = this.batchRepositories.get(entity) as
      | (new () => AutomationBatchRepository<S>)
      | undefined;
    if (cached) return cached;
    class BatchRepository extends AutomationBatchRepository<S> {
      constructor() {
        super(entity);
      }
    }
    this.batchRepositories.set(entity, BatchRepository);
    return BatchRepository;
  }
  public decodeRaw(row: Record<string, unknown>): Infer<T> {
    const mapped: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(this.table)) {
      const value = Object.hasOwn(row, column.name)
        ? row[column.name]
        : row[key];
      mapped[key] = value == null ? value : column.mapFromDriverValue(value);
    }
    return this.clean(mapped, this.entity.schema);
  }
}
