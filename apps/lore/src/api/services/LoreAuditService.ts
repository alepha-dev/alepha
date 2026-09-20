import { $inject } from "alepha";
import { type AuditEntity, AuditService } from "alepha/api/audits";
import type { CreateAudit } from "alepha/api/audits";
import { $logger } from "alepha/logger";

import { LoreAnalytics } from "../entities/loreAnalytics.ts";

/**
 * The framework's audit log, plus the rate point that goes with it (#E65).
 *
 * ## Why a subclass and not a helper on `LoreAudits`
 *
 * Every rate the `project_activity` dataset carries is one audit row, so the
 * two writes have to be one code path or they drift the first time somebody
 * adds an audit call site and forgets the other half. `LoreAudits` declares
 * the `$audit` types; it never writes, and there are 38 `logSuccess` call
 * sites across the controllers that do. A helper there would be 38 places
 * that must remember to use it.
 *
 * `AuditService.create` is the one funnel every one of them reaches, through
 * `$audit.log` to `AuditService.record`, and it already returns the row it
 * wrote. Overriding it is therefore the whole recording surface, and
 * `alepha/api/audits` itself stays untouched - the epic's own boundary.
 *
 * Substituted in `LoreApi`'s `register()`, which runs before its imports are
 * wired, so it wins over anything `AlephaApiAudits` provides.
 *
 * ## ⚠️ The point is per `create()` CALL, not per stored row
 *
 * A type that coalesces folds a burst into one row carrying an `eventCount`,
 * and `create()` still runs once per event: the fold happens inside it. So
 * recording `count: 1` here makes the dataset's sum equal `SUM(event_count)`
 * over the same window, which is exactly what `HomeController.momentum` asked
 * the audit table for. Reading `entry.eventCount` instead would count a
 * ten-event burst as 1 + 2 + ... + 10.
 */
export class LoreAuditService extends AuditService {
  protected readonly logger = $logger();
  protected readonly datasets = $inject(LoreAnalytics);

  /**
   * Writes the audit row, then the rate point beside it.
   *
   * The point is awaited rather than fired and forgotten, because on Workers
   * an un-awaited promise after the response is returned is simply dropped.
   * It is cheap: a `writeDataPoint` into Analytics Engine on production, one
   * upsert on a relational backend, nothing in memory.
   */
  public override async create(data: CreateAudit): Promise<AuditEntity> {
    const entry = await super.create(data);
    await this.recordActivity(entry);
    return entry;
  }

  /**
   * One point per project-scoped audit event, best effort.
   *
   * ⚠️ **Best effort is the whole contract.** An audit write must never be the
   * thing that fails the action it records - that is why `AuditService.create`
   * clamps its own text columns - and a rate point is a weaker claim still.
   * On production this is an HTTP-shaped call into Analytics Engine, so it has
   * a failure mode the audit insert does not; a throw here would roll back the
   * quest that caused it.
   *
   * ⚠️ **App-layer rows are skipped, not defaulted.** A sign-in, a project
   * created before there is a project to file it under, a parameter change:
   * all carry `scopeId: undefined`, and there is no project they belong to.
   * Landing them under `""` would be a real dimension value on every backend,
   * summed into no chart, and still spending Analytics Engine's per-index
   * sampling budget. `scopeType` is checked too rather than `scopeId` alone,
   * because the dataset's `project` dimension means a project id and a future
   * scope of another kind would otherwise be read as one.
   */
  protected async recordActivity(entry: AuditEntity): Promise<void> {
    if (entry.scopeType !== "project" || !entry.scopeId) {
      return;
    }

    try {
      await this.datasets.activity.record({
        project: entry.scopeId,
        type: entry.type,
        action: entry.action,
        actor: entry.userId ?? "system",
        count: 1,
      });
    } catch (error) {
      this.logger.warn("Activity rate point not recorded", {
        type: entry.type,
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
