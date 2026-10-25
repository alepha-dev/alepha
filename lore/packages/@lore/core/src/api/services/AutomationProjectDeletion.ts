import { $inject } from "alepha";
import { DbCacheProvider, sql } from "alepha/orm";

import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { ProjectDeletionService } from "./ProjectDeletionService.ts";

/**
 * Automations' step of a project deletion. Runs, receipts and adoption
 * markers reference their rule with `ON DELETE RESTRICT`, and every one of
 * those tables also cascades from the project, so whether a hard delete of
 * the project succeeds depended on the order the database walked its
 * cascades. The children go first, in one native batch, before the row.
 *
 * A soft delete removes no row and cascades nothing, so the history is kept.
 */
export class AutomationProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly cache = $inject(DbCacheProvider);

  constructor() {
    this.deletion.registerStep({
      order: 0,
      before: true,
      run: async (projectId, { force }) => {
        if (!force) return;
        // Every row a restrictive key protects hangs off a rule: a project
        // with none (the common case, and every compensating delete of a
        // project that failed to finish being created) needs no batch.
        const any = await this.persistence.rules.findOne(
          { where: { projectId } },
          { force: true },
        );
        if (!any) return;
        const rules = sql`SELECT id FROM automations WHERE project_id = ${projectId}`;
        await this.database.batch([
          sql`DELETE FROM automation_receipts WHERE project_id = ${projectId} OR automation_id IN (${rules})`,
          sql`DELETE FROM automation_runs WHERE project_id = ${projectId} OR automation_id IN (${rules})`,
          sql`DELETE FROM automation_adoptions WHERE project_id = ${projectId} OR automation_id IN (${rules})`,
          sql`DELETE FROM automations WHERE project_id = ${projectId}`,
        ]);
        for (const table of [
          "automation_receipts",
          "automation_runs",
          "automation_adoptions",
          "automations",
        ])
          await this.cache.invalidateTable(table);
      },
    });
  }
}
