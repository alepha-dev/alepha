import { $inject, type Infer, type ZObject, z } from "alepha";
import { type EntityPrimitive, Repository, type SQLLike } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { BatchRepository } from "./BatchRepository.ts";
import { GuardedBatch } from "./GuardedBatch.ts";
import { LoreDatabase } from "./LoreDatabase.ts";
import { ProjectEvents } from "./ProjectEvents.ts";

/**
 * How a source writes a change that must be recorded as a fact: the change and
 * its event, in one guarded batch, or neither (#Q3899).
 *
 * Reuses the repository codec, predicates, version bump, cache and lifecycle
 * hooks while committing its one prepared statement with the project event
 * (#Q3889) and, when someone is subscribed, its delivery job (#Q3890).
 */
export class SourceRepository<T extends ZObject> extends BatchRepository<T> {
  protected static readonly sources = new WeakMap<
    EntityPrimitive<any>,
    unknown
  >();
  protected readonly atomic = $inject(GuardedBatch);
  protected readonly database = $inject(LoreDatabase);
  protected readonly projectEvents = $inject(ProjectEvents);

  public static override of<S extends ZObject>(
    entity: EntityPrimitive<S>,
  ): new () => SourceRepository<S> {
    const cached = this.sources.get(entity) as
      | (new () => SourceRepository<S>)
      | undefined;
    if (cached) return cached;
    class EntitySourceRepository extends SourceRepository<S> {
      constructor() {
        super(entity);
      }
    }
    this.sources.set(entity, EntitySourceRepository);
    return EntitySourceRepository;
  }

  public async sourceCreate(
    data: Parameters<Repository<T>["create"]>[0],
    where: Parameters<Repository<T>["updateOne"]>[0],
    event: SourceEvent,
  ): Promise<Infer<T>> {
    return this.database.primary(async () => {
      await this.alepha.events.emit("repository:create:before", {
        tableName: this.tableName,
        data,
      });
      const rows = await this.commit(
        event,
        this.notExists(where),
        this.insertStatement(data, { events: false }),
        event.generatedIdField
          ? {
              [event.generatedIdField]: this.scalar(
                where,
                this.id.key as keyof Infer<T>,
              ),
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
    event: SourceEvent,
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
      // RETURNING gives the changed row without reusing a now-false transition
      // predicate. It is also available from D1's prepared native batch.
      const rows = await this.commit(
        event,
        this.exists(where),
        this.updateStatement(
          where,
          row as Parameters<Repository<T>["updateOne"]>[1],
          {
            events: false,
          },
        ),
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
  public async sourceSave(entity: Infer<T>, event: SourceEvent): Promise<void> {
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
    event: SourceEvent,
    condition: SQLLike,
    mutation: SQLLike,
    numbers?: Record<string, SQLLike>,
  ): Promise<Record<string, unknown>[] | undefined> {
    const recorded = await this.projectEvents.emit({
      projectId: event.projectId,
      name: event.name,
      subjectId: event.subjectId,
      fields: event.fields,
      numbers: { ...event.numbers, ...numbers },
    });
    let rows: Record<string, unknown>[] | undefined;
    try {
      rows = (
        await this.atomic.guarded(condition, [mutation, ...recorded.statements])
      )[1];
    } catch (error) {
      // A false guard is a lost transition, which `result` reports as a
      // conflict; a driver failure stays a failure.
      if (await this.atomic.holds(condition)) throw error;
      return undefined;
    }
    await recorded.committed();
    return rows;
  }
  protected result(rows: Record<string, unknown>[] | undefined): Infer<T> {
    if (!rows?.[0])
      throw new ConflictError("Source transition was already recorded");
    return this.decodeRow(rows[0]);
  }
}
export interface SourceEvent {
  projectId: number;
  /**
   * The project event's name (`ProjectEventCatalog`).
   */
  name: string;
  /**
   * The event's subject id (`ProjectEventInput.subjectId`).
   */
  subjectId?: string | number;
  fields: Record<string, unknown>;
  resourceId?: string | number;
  generatedIdField?: string;
  numbers?: Record<string, SQLLike>;
}
