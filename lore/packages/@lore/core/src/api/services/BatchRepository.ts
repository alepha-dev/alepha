import { type ZObject } from "alepha";
import {
  type EntityPrimitive,
  Repository,
  sql,
  type SQLLike,
  type UpdateStatementOptions,
} from "alepha/orm";

/**
 * A repository for writes that sit in a guarded batch (`GuardedBatch`): the
 * framework's statement builders, with `touch: false` as the UPDATE default,
 * so a statement stamps `updatedAt` only when its patch carries it (#Q3899).
 */
export class BatchRepository<T extends ZObject> extends Repository<T> {
  protected static readonly batchRepositories = new WeakMap<
    EntityPrimitive<any>,
    unknown
  >();
  public static override of<S extends ZObject>(
    entity: EntityPrimitive<S>,
  ): new () => BatchRepository<S> {
    const cached = this.batchRepositories.get(entity) as
      | (new () => BatchRepository<S>)
      | undefined;
    if (cached) return cached;
    class EntityBatchRepository extends BatchRepository<S> {
      constructor() {
        super(entity);
      }
    }
    this.batchRepositories.set(entity, EntityBatchRepository);
    return EntityBatchRepository;
  }
  /**
   * The framework's statement builder, with the guarded batch's default: an
   * UPDATE never stamps `updatedAt` unless the patch carries it.
   */
  public override updateStatement(
    where: Parameters<Repository<T>["updateStatement"]>[0],
    data: Parameters<Repository<T>["updateStatement"]>[1],
    opts: UpdateStatementOptions = {},
  ) {
    return super.updateStatement(where, data, { touch: false, ...opts });
  }
  public andConditions(conditions: SQLLike[]): SQLLike {
    return sql.join(
      conditions.map(
        (condition) =>
          sql`(${typeof condition === "string" ? sql.raw(condition) : condition.getSQL()})`,
      ),
      sql` AND `,
    );
  }
}
