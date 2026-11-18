import { AlephaError, type Infer, type ZObject, z } from "alepha";
import { type EntityPrimitive, Repository } from "alepha/orm";

import { BatchRepository } from "./BatchRepository.ts";

/**
 * The guarded batch's repository, plus the effect preparation the automation
 * engine shares across entities.
 */
export class AutomationBatchRepository<
  T extends ZObject,
> extends BatchRepository<T> {
  protected static readonly automationBatchRepositories = new WeakMap<
    EntityPrimitive<any>,
    unknown
  >();
  public static override of<S extends ZObject>(
    entity: EntityPrimitive<S>,
  ): new () => AutomationBatchRepository<S> {
    const cached = this.automationBatchRepositories.get(entity) as
      | (new () => AutomationBatchRepository<S>)
      | undefined;
    if (cached) return cached;
    class AutomationEntityBatchRepository extends AutomationBatchRepository<S> {
      constructor() {
        super(entity);
      }
    }
    this.automationBatchRepositories.set(
      entity,
      AutomationEntityBatchRepository,
    );
    return AutomationEntityBatchRepository;
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
        {
          events: false,
        },
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
