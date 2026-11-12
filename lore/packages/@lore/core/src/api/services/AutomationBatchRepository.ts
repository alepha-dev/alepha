import { AlephaError, type Infer, type ZObject, z } from "alepha";
import {
  type EntityPrimitive,
  Repository,
  sql,
  type SQLLike,
  type UpdateStatementOptions,
} from "alepha/orm";

/**
 * A repository for writes that sit in an automation's guarded batch: the
 * framework's statement builders, with `touch: false` as the UPDATE default,
 * plus the effect preparation the automation engine shares across entities.
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
  /**
   * The framework's statement builder, with the automation engine's default:
   * an UPDATE in a guarded batch never stamps `updatedAt` unless the patch
   * carries it, as the raw statements it replaced did not.
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
  public async prepareEffectCreate(
    data: Parameters<Repository<T>["create"]>[0],
  ) {
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });
    // `events: false`: `finishEffect` invalidates and emits once the effect
    // is recorded, so a failing listener fails the effect, not the batch.
    return { statement: this.insertStatement(data, { events: false }), data };
  }
  public async prepareEffectSave(entity: Infer<T>) {
    if (entity[this.id.key] == null)
      throw new AlephaError("An automation update requires an entity identity");
    const row = { ...entity } as Record<string, unknown>;
    for (const key of Object.keys(z.schema.shape(this.entity.schema)))
      if (row[key] === undefined) row[key] = null;
    const version = this.versionField();
    const where = {
      [this.id.key as string]: row[this.id.key as string],
      ...(version && typeof row[version.key] === "number"
        ? { [version.key]: row[version.key] }
        : {}),
    } as Parameters<Repository<T>["updateOne"]>[0];
    await this.alepha.events.emit("repository:update:before", {
      tableName: this.tableName,
      where,
      data: row,
    });
    if (Object.hasOwn(z.schema.shape(this.entity.schema), "updatedAt"))
      row.updatedAt = this.dateTimeProvider.nowISOString();
    return {
      statement: this.updateStatement(
        where,
        row as Parameters<Repository<T>["updateOne"]>[1],
        { events: false },
      ),
      condition: this.exists(where),
      where,
      data: row,
    };
  }
  /**
   * The entity an effect's statement returned, after its cache invalidation
   * and `repository:*:after` event: the effect statements are built with
   * `events: false` so these run here, once the effect is recorded.
   */
  public async finishEffect(
    mode: "create" | "update",
    raw: Record<string, unknown>,
    data: object,
    where: unknown = {},
  ): Promise<Infer<T>> {
    const entity = this.decodeRow(raw);
    await this.invalidateCache({});
    if (mode === "create")
      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data,
        entity,
      });
    else
      await this.alepha.events.emit("repository:update:after", {
        tableName: this.tableName,
        where,
        data,
        entities: [entity],
      });
    return entity;
  }
}
