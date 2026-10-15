import { AlephaError, type Infer, type ZObject, z } from "alepha";
import {
  type EntityPrimitive,
  Repository,
  sql,
  type SQLLike,
} from "alepha/orm";

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
  /**
   * Prepare the normal driver's insert codecs without writing before the
   * caller's native receipt batch. This seam deliberately dispatches no job.
   */
  public insertStatement(data: Parameters<Repository<T>["create"]>[0]) {
    return this.rawInsert().values(this.cast(data, true));
  }
  public scalar(
    where: Parameters<Repository<T>["updateOne"]>[0],
    field: keyof Infer<T>,
  ): SQLLike {
    return sql`(SELECT ${this.table[field as keyof typeof this.table]} FROM ${this.table} WHERE ${this.toSQL(this.withDeletedAt(where, {}))} LIMIT 1)`;
  }
  public predicate(where: Parameters<Repository<T>["updateOne"]>[0]): SQLLike {
    return this.toSQL(this.withDeletedAt(where, {}))!;
  }
  public notExists(where: Parameters<Repository<T>["updateOne"]>[0]): SQLLike {
    return sql`NOT EXISTS (SELECT 1 FROM ${this.table} WHERE ${this.toSQL(this.withDeletedAt(where, {}))})`;
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
  public exists(where: Parameters<Repository<T>["updateOne"]>[0]): SQLLike {
    return sql`EXISTS (SELECT 1 FROM ${this.table} WHERE ${this.toSQL(this.withDeletedAt(where, {}))})`;
  }
  public updateStatement(
    where: Parameters<Repository<T>["updateOne"]>[0],
    data: Parameters<Repository<T>["updateOne"]>[1],
    returning = true,
  ) {
    const values = this.cast(data, false) as Record<string, unknown>;
    delete values[this.id.key as string];
    this.withVersionBump(values);
    const query = this.rawUpdate()
      .set(values as any)
      .where(this.toSQL(this.withDeletedAt(where, {})));
    return returning ? query.returning(this.table) : query;
  }
  public async prepareEffectCreate(
    data: Parameters<Repository<T>["create"]>[0],
  ) {
    await this.alepha.events.emit("repository:create:before", {
      tableName: this.tableName,
      data,
    });
    return {
      statement: this.insertStatement(data).returning(this.table),
      data,
    };
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
      ),
      condition: this.exists(where),
      where,
      data: row,
    };
  }
  public async finishEffect(
    mode: "create" | "update",
    raw: Record<string, unknown>,
    data: object,
    where: unknown = {},
  ): Promise<Infer<T>> {
    const entity = this.decodeRaw(raw);
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
