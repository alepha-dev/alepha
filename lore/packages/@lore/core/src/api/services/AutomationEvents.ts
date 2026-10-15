import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql, type SQLLike } from "alepha/orm";
import { ConflictError } from "alepha/server";

import {
  type AutomationEvent,
  automationEvents,
} from "../entities/automationEvents.ts";
import {
  automationEventPayloadSchema,
  type AutomationEventPayload,
} from "../schemas/automationEventPayloadSchema.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Source producers prepare one validated domain transition and its event in
 * the same native batch. Dispatch is recoverable from the table after a crash.
 */
export class AutomationEvents {
  protected readonly eventRows = $inject(
    AutomationBatchRepository.of(automationEvents),
  );
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected consumer?: (
    event: AutomationEvent,
    limit: number,
  ) => Promise<{ done: boolean; cursor?: string; claimed: number }>;

  public register(consumer: NonNullable<AutomationEvents["consumer"]>): void {
    if (this.consumer)
      throw new AlephaError(
        "An automation event consumer is already registered",
      );
    this.consumer = consumer;
  }

  public async transition(input: {
    projectId: number;
    identity: string;
    name: AutomationEvent["name"];
    fields: Record<string, unknown>;
    condition: SQLLike;
    mutation: SQLLike;
    changedTables: string[];
    numbers?: Record<string, SQLLike>;
  }): Promise<{
    event: AutomationEvent;
    committed: boolean;
    rows?: Record<string, unknown>[];
  }> {
    return this.database.primary(async () => {
      const now = this.dateTime.nowISOString();
      const replayUntil = this.dateTime.now().add(90, "days").toISOString();
      const id = crypto.randomUUID();
      const payload = this.payload(input.name, {
        ...input.fields,
        ...Object.fromEntries(
          Object.keys(input.numbers ?? {}).map((key) => [
            key,
            Number.MIN_SAFE_INTEGER,
          ]),
        ),
      });
      for (const key of Object.keys(input.numbers ?? {})) {
        const descriptor = this.catalog
          .entries()
          .find((entry) => entry.key === input.name);
        if (descriptor?.fields[key] !== "number")
          throw new AlephaError(
            "Computed event fields must be declared numbers",
          );
      }
      const encoded = input.numbers
        ? this.database.numberFields(
            payload,
            Object.fromEntries(
              Object.entries(input.numbers).filter(
                ([key]) => !payload.omitted.includes(key),
              ),
            ),
          )
        : JSON.stringify(payload);
      let rows: Record<string, unknown>[] | undefined;
      let event: AutomationEvent;
      try {
        const batch = await this.atomic.guarded(
          input.projectId,
          input.condition,
          [
            input.mutation,
            sql`INSERT INTO automation_events (id, version, project_id, identity, name, occurred_at, replay_until, payload, created_at, updated_at)
              VALUES (${id}, 0, ${input.projectId}, ${input.identity}, ${input.name}, ${this.database.timestamp(now)}, ${this.database.timestamp(replayUntil)}, ${encoded}, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}) RETURNING *`,
          ],
        );
        rows = batch[1];
        event = this.eventRows.decodeRaw(batch[2][0]);
      } catch {
        const recorded = await this.persistence.events.findOne({
          where: { projectId: input.projectId, identity: input.identity },
        });
        if (recorded) return { event: recorded, committed: false };
        throw new ConflictError(
          "Source transition was not committed; reload before retrying",
        );
      }
      for (const table of new Set([
        ...input.changedTables,
        "automation_events",
        "automation_receipts",
      ]))
        await this.cache.invalidateTable(table);
      return {
        event,
        committed: true,
        rows,
      };
    });
  }

  public payload(
    name: AutomationEvent["name"],
    input: Record<string, unknown>,
  ): AutomationEventPayload {
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.type === "event" && entry.key === name);
    if (!descriptor) throw new AlephaError("Unknown source event vocabulary");
    const payload: AutomationEventPayload = { fields: {}, omitted: [] };
    for (const [key, kind] of Object.entries(descriptor.fields)) {
      if (!Object.hasOwn(input, key)) continue;
      const value = input[key];
      const valid =
        value === null ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          ["number", "release"].includes(kind)) ||
        (typeof value === "string" &&
          !["number", "release", "boolean", "textArray"].includes(kind) &&
          new TextEncoder().encode(value).byteLength <= 16_384) ||
        (typeof value === "boolean" && kind === "boolean");
      if (valid)
        payload.fields[key] = value as string | number | boolean | null;
      if (!valid || !automationEventPayloadSchema.safeParse(payload).success) {
        payload.fields[key] = null;
        payload.omitted.push(key);
      }
    }
    return automationEventPayloadSchema.parse(payload);
  }

  public async sweep(limit = 50): Promise<number> {
    return this.database.primary(async () => {
      if (!this.consumer) return 0;
      const now = this.dateTime.nowISOString();
      const events = await this.persistence.events.findMany({
        where: {
          dispatchedAt: { isNull: true },
          replayUntil: { gt: now },
          or: [{ leaseUntil: { isNull: true } }, { leaseUntil: { lte: now } }],
        },
        orderBy: [
          { column: "attempts", direction: "asc" },
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 50,
      });
      let claimed = 0;
      for (const event of events) {
        if (claimed >= limit) break;
        const leaseToken = crypto.randomUUID();
        const acquired = await this.persistence.events.updateMany(
          {
            id: event.id,
            version: event.version,
            dispatchedAt: { isNull: true },
            or: [
              { leaseUntil: { isNull: true } },
              { leaseUntil: { lte: now } },
            ],
          },
          {
            leaseToken,
            attempts: event.attempts + 1,
            leaseUntil: this.dateTime.now().add(2, "minutes").toISOString(),
          },
        );
        if (!acquired.length) continue;
        try {
          const result = await this.consumer(
            await this.persistence.events.getById(event.id),
            limit - claimed,
          );
          if (
            !Number.isSafeInteger(result.claimed) ||
            result.claimed < 0 ||
            result.claimed > limit - claimed
          )
            throw new AlephaError(
              "Event consumer exceeded the dispatcher budget",
            );
          claimed += result.claimed;
          await this.persistence.events.updateMany(
            { id: event.id, leaseToken },
            {
              ...(result.cursor ? { cursor: result.cursor } : {}),
              ...(result.done
                ? {
                    dispatchedAt: this.dateTime.nowISOString(),
                    payload: { fields: {}, omitted: ["payload_retired"] },
                  }
                : {}),
              leaseToken: null,
              leaseUntil: null,
            },
          );
        } catch {
          // Leave the committed intent discoverable. A run/occurrence claim,
          // not the active lifetime of a queue job, deduplicates the retry.
          await this.persistence.events.updateMany(
            { id: event.id, leaseToken },
            { leaseToken: null, leaseUntil: null },
          );
        }
      }
      return claimed;
    });
  }

  public async prune(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const rows = await this.persistence.events.findMany({
      where: {
        replayUntil: { lt: now },
        or: [{ leaseUntil: { isNull: true } }, { leaseUntil: { lt: now } }],
      },
      orderBy: "replayUntil",
      columns: ["id"],
      limit: 50,
    });
    if (!rows.length) return 0;
    return (
      await this.persistence.events.deleteMany({
        id: { inArray: rows.map((row) => row.id) },
        replayUntil: { lt: now },
      })
    ).length;
  }
}
