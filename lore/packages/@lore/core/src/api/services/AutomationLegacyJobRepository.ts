import { AlephaError } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql } from "alepha/orm";

import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationIdentity } from "./AutomationIdentity.ts";
import {
  AutomationLegacyHandled,
  type AutomationLegacyFence,
} from "./AutomationLegacyQueue.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Join the existing job row and legacy bookkeeping under the same adoption predicate.
 */
export class AutomationLegacyJobRepository extends AutomationBatchRepository<
  typeof jobExecutionEntity.schema
> {
  constructor() {
    super(jobExecutionEntity);
  }
  public override async create(
    ...args: Parameters<
      AutomationBatchRepository<typeof jobExecutionEntity.schema>["create"]
    >
  ) {
    const fence = this.alepha.context.get<AutomationLegacyFence>(
      "lore.automations.legacy-enqueue",
    );
    if (!fence) return super.create(...args);
    return this.alepha.inject(AutomationDatabase).primary(async () => {
      const data = args[0];
      const payload = data.payload as
        | { template?: string; type?: string; contact?: string }
        | undefined;
      if (
        data.jobName !== "system.notifications.send" ||
        payload?.template !== fence.template ||
        !payload.type
      )
        throw new AlephaError("Legacy enqueue fence received an unrelated job");
      const id = await this.alepha
        .inject(AutomationIdentity)
        .hash([
          "legacy",
          fence.projectId,
          fence.policy,
          fence.identity,
          payload.contact ?? null,
          payload.type,
        ]);
      const persistence = this.alepha.inject(AutomationPersistence);
      if (await persistence.receipts.findById(id))
        throw new AutomationLegacyHandled(
          "Legacy notification was already enqueued",
        );
      const time = this.alepha.inject(DateTimeProvider);
      const now = time.nowISOString();
      const database = this.alepha.inject(AutomationDatabase);
      const prepared = await this.prepareEffectCreate(data);
      const mutation = prepared.statement;
      let batch: Record<string, unknown>[][];
      try {
        batch = await this.alepha
          .inject(AutomationAtomic)
          .guarded(
            fence.projectId,
            sql`NOT EXISTS (SELECT 1 FROM automation_adoptions WHERE project_id = ${fence.projectId} AND policy = ${fence.policy} AND state = 'adopted') AND NOT EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${id}) AND (${fence.condition ?? sql`TRUE`})`,
            [
              mutation,
              sql`INSERT INTO automation_receipts (id, version, project_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, cursor, queue_attempts, roster_complete, created_at, updated_at) VALUES (${id}, 0, ${fence.projectId}, ${id}, 'legacy', 'committed', ${`legacy:${id}`}, 0, ${database.timestamp(now)}, ${database.timestamp(time.now().add(90, "days").toISOString())}, 0, 0, FALSE, ${database.timestamp(now)}, ${database.timestamp(now)})`,
              ...(fence.statements ?? []),
            ],
          );
      } catch (error) {
        if (
          (await persistence.receipts.findById(id)) ||
          (await persistence.adoptions.findOne({
            where: {
              projectId: fence.projectId,
              policy: fence.policy,
              state: "adopted",
            },
          }))
        )
          throw new AutomationLegacyHandled(
            "Legacy policy is already handled or adopted",
          );
        throw error;
      }
      await this.invalidateCache({});
      for (const table of fence.changedTables ?? [])
        await this.alepha.inject(DbCacheProvider).invalidateTable(table);
      const entity = this.decodeRaw(batch[1][0]);
      await this.alepha.events.emit("repository:create:after", {
        tableName: this.tableName,
        data,
        entity,
      });
      return entity;
    });
  }
  public override async createMany(
    ...args: Parameters<
      AutomationBatchRepository<typeof jobExecutionEntity.schema>["createMany"]
    >
  ) {
    if (!this.alepha.context.get("lore.automations.legacy-enqueue"))
      return super.createMany(...args);
    const rows = [];
    for (const data of args[0]) {
      try {
        rows.push(await this.create(data));
      } catch (error) {
        if (!(error instanceof AutomationLegacyHandled)) throw error;
      }
    }
    return rows;
  }
}
