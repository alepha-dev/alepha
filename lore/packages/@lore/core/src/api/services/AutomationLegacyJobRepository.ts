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
      const prepared = await this.prepareEffectCreate(data);
      const mutation = prepared.statement;
      let batch: Record<string, unknown>[][];
      try {
        batch = await this.alepha.inject(AutomationAtomic).guarded(
          fence.projectId,
          sql`NOT EXISTS ${persistence.adoptions.subquery({
            projectId: fence.projectId,
            policy: fence.policy,
            state: "adopted",
          })} AND NOT EXISTS ${persistence.receipts.subquery({ id })} AND (${fence.condition ?? sql`TRUE`})`,
          [
            mutation,
            persistence.receipts.insertStatement({
              id,
              projectId: fence.projectId,
              identity: id,
              kind: "legacy",
              status: "committed",
              occurrenceId: `legacy:${id}`,
              ruleRevision: 0,
              occurredAt: now,
              replayUntil: time.now().add(90, "days").toISOString(),
              cursor: 0,
              queueAttempts: 0,
              rosterComplete: false,
              createdAt: now,
              updatedAt: now,
            }),
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
      const entity = this.decodeRow(batch[1][0]);
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
