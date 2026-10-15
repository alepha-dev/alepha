import { $inject, type Infer, type ZObject, z } from "alepha";
import {
  type EntityPrimitive,
  Repository,
  sql,
  type SQLLike,
} from "alepha/orm";
import { ConflictError } from "alepha/server";

import type { AutomationEvent } from "../entities/automationEvents.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationEvents } from "./AutomationEvents.ts";
import { AutomationOrigin } from "./AutomationOrigin.ts";

/**
 * Reuses the repository codec, predicates, version bump, cache and lifecycle
 * hooks while committing its one prepared statement with the durable event.
 */
export class AutomationSourceRepository<
  T extends ZObject,
> extends AutomationBatchRepository<T> {
  protected static readonly sources = new WeakMap<
    EntityPrimitive<any>,
    unknown
  >();
  protected readonly events = $inject(AutomationEvents);
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly origin = $inject(AutomationOrigin);

  public static override of<S extends ZObject>(
    entity: EntityPrimitive<S>,
  ): new () => AutomationSourceRepository<S> {
    const cached = this.sources.get(entity) as
      | (new () => AutomationSourceRepository<S>)
      | undefined;
    if (cached) return cached;
    class SourceRepository extends AutomationSourceRepository<S> {
      constructor() {
        super(entity);
      }
    }
    this.sources.set(entity, SourceRepository);
    return SourceRepository;
  }

  public async sourceCreate(
    data: Parameters<Repository<T>["create"]>[0],
    where: Parameters<Repository<T>["updateOne"]>[0],
    event: AutomationSourceEvent,
  ): Promise<Infer<T>> {
    return this.database.primary(async () => {
      await this.alepha.events.emit("repository:create:before", {
        tableName: this.tableName,
        data,
      });
      const predicate = this.toSQL(this.withDeletedAt(where, {}));
      const mutation = this.rawInsert()
        .values(this.cast(data, true))
        .returning(this.table);
      const rows = await this.commit(
        event,
        sql`NOT EXISTS (SELECT 1 FROM ${this.table} WHERE ${predicate})`,
        mutation,
        event.generatedIdField
          ? {
              [event.generatedIdField]: sql`(SELECT ${this.col(this.id.key as keyof Infer<T>)} FROM ${this.table} WHERE ${predicate})`,
            }
          : undefined,
      );
      await this.invalidateCache({});
      const entity = this.result(rows);
      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data,
        entity,
      });
      return entity;
    });
  }
  public async sourceUpdate(
    where: Parameters<Repository<T>["updateOne"]>[0],
    data: Parameters<Repository<T>["updateOne"]>[1],
    event: AutomationSourceEvent,
  ): Promise<Infer<T>> {
    return this.database.primary(async () => {
      await this.alepha.events.emit("repository:update:before", {
        tableName: this.tableName,
        where,
        data,
      });
      const row: Record<string, unknown> = { ...data };
      if (Object.hasOwn(z.schema.shape(this.entity.schema), "updatedAt"))
        row.updatedAt = this.dateTimeProvider.nowISOString();
      const values = this.cast(row, false) as Record<string, unknown>;
      delete values[this.id.key as string];
      this.withVersionBump(values);
      const predicate = this.toSQL(this.withDeletedAt(where, {}));
      // RETURNING gives the changed row without reusing a now-false transition
      // predicate. It is also available from D1's prepared native batch.
      const mutation = this.rawUpdate()
        .set(values as never)
        .where(predicate)
        .returning(this.table);
      const rows = await this.commit(
        event,
        sql`EXISTS (SELECT 1 FROM ${this.table} WHERE ${predicate})`,
        mutation,
      );
      await this.invalidateCache({});
      const entity = this.result(rows);
      await this.alepha.events.emit("repository:update:after", {
        tableName: this.tableName,
        where,
        data,
        entities: [entity],
      });
      return entity;
    });
  }
  public async sourceSave(
    entity: Infer<T>,
    event: AutomationSourceEvent,
  ): Promise<void> {
    const row = { ...(entity as Record<string, unknown>) };
    for (const key of Object.keys(z.schema.shape(this.entity.schema)))
      if (row[key] === undefined) row[key] = null;
    const id = row[this.id.key as string] as string | number;
    const version = this.versionField();
    const where: Record<string, unknown> = { [this.id.key]: id };
    if (version && typeof row[version.key] === "number")
      where[version.key] = row[version.key];
    const updated = await this.sourceUpdate(where as never, row as never, {
      ...event,
      resourceId: id,
    });
    for (const key of Object.keys(z.schema.shape(this.entity.schema)))
      (entity as Record<string, unknown>)[key] = undefined;
    Object.assign(entity, updated);
  }
  protected async commit(
    event: AutomationSourceEvent,
    condition: SQLLike,
    mutation: SQLLike,
    numbers?: Record<string, SQLLike>,
  ): Promise<Record<string, unknown>[] | undefined> {
    if (this.origin.current)
      return (
        await this.atomic.guarded(event.projectId, condition, [mutation])
      )[1];
    return (
      await this.events.transition({
        ...event,
        condition,
        mutation,
        changedTables: [this.tableName],
        numbers: { ...event.numbers, ...numbers },
      })
    ).rows;
  }
  protected result(rows: Record<string, unknown>[] | undefined): Infer<T> {
    if (!rows?.[0])
      throw new ConflictError("Source transition was already recorded");
    return this.decodeRaw(rows[0]);
  }
}
export interface AutomationSourceEvent {
  projectId: number;
  identity: string;
  name: AutomationEvent["name"];
  fields: Record<string, unknown>;
  resourceId?: string | number;
  generatedIdField?: string;
  numbers?: Record<string, SQLLike>;
}
