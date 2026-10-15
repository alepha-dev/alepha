import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { sql } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { AutomationCron } from "../schemas/AutomationCron.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationDispatchRegistry } from "./AutomationDispatchRegistry.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";

/**
 * Claims administrative ready frames only. Selection and effects run in a
 * queued worker under current author authority, never in a cron hot path.
 */
export class AutomationSchedules {
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly cron = $inject(AutomationCron);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly dispatcher = $inject(AutomationDispatchRegistry);
  constructor() {
    this.dispatcher.register("schedules", (limit) => this.sweep(limit));
  }

  public async sweep(limit = 50): Promise<number> {
    return (await this.sweepDetailed(limit)).claimed;
  }
  public async sweepDetailed(
    limit = 50,
  ): Promise<{ claimed: number; scanned: number; hasMore: boolean }> {
    if (limit < 1) return { claimed: 0, scanned: 0, hasMore: false };
    return this.database.primary(async () => {
      const now = this.time.nowISOString();
      const pending = this.persistence.receipts.subquery({
        automationId: { eq: this.persistence.rules.table.id },
        kind: "occurrence",
        status: { inArray: ["ready", "claimed"] },
      });
      const size = Math.min(50, limit);
      const page = await this.persistence.rules.findMany({
        where: {
          enabled: true,
          health: "active",
          requiresApproval: false,
          nextRunAt: { lte: now },
          notExists: pending,
        },
        orderBy: [
          { column: "nextRunAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: size + 1,
      });
      const rules = page.slice(0, size);
      let claimed = 0;
      for (const rule of rules) {
        if (rule.rule.trigger.kind !== "schedule" || !rule.nextRunAt) continue;
        let cron: string;
        let scheduledAt: string;
        let next: string;
        try {
          cron = this.cron.validate(
            rule.scheduleCron ?? rule.rule.trigger.cron,
          );
          scheduledAt = this.cron.latest(cron, now);
          next = this.cron.next(cron, now);
        } catch (error) {
          await this.evidence.transition(
            rule.id,
            "broken",
            error instanceof Error ? error.message : "Invalid UTC schedule",
            false,
          );
          continue;
        }
        const free = sql`NOT EXISTS (SELECT 1 FROM automation_receipts WHERE automation_id = ${rule.id} AND kind = 'occurrence' AND status IN ('ready', 'claimed'))`;
        const condition = sql`EXISTS (SELECT 1 FROM automations WHERE id = ${rule.id} AND next_run_at = ${this.database.timestamp(rule.nextRunAt)} AND ${rule.scheduleCron ? sql`schedule_cron = ${rule.scheduleCron}` : sql`schedule_cron IS NULL`}) AND ${free}`;
        const mutation = sql`UPDATE automations SET next_run_at = ${this.database.timestamp(next)}, schedule_cron = ${cron}, version = version + 1, updated_at = ${this.database.timestamp(now)} WHERE id = ${rule.id}`;
        if (scheduledAt < rule.nextRunAt) {
          // An old cursor no longer belongs to the current compiled schedule.
          // Move it to the future without manufacturing an occurrence.
          await this.persistence.rules.updateMany(
            { id: rule.id, revision: rule.revision, version: rule.version },
            { nextRunAt: next, scheduleCron: cron },
          );
          continue;
        }
        try {
          await this.claims.reserve({
            automationId: rule.id,
            revision: rule.revision,
            source: { kind: "schedule", scheduledAt },
            condition,
            mutation,
            changedTables: ["automations"],
          });
          claimed += 1;
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
        }
      }
      return { claimed, scanned: rules.length, hasMore: page.length > size };
    });
  }
}
