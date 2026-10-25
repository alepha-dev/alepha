import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { sql, type SQLLike } from "alepha/orm";

import { AutomationDatabase } from "./AutomationDatabase.ts";

/**
 * A failed explicit non-null ID CHECK assertion aborts the entire native batch.
 * This makes a lost claim/version predicate a rollback, not a zero-row update
 * followed by an unguarded effect. Guard rows are removed in the same batch.
 */
export class AutomationAtomic {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async guarded(
    projectId: number,
    condition: SQLLike,
    statements: SQLLike[],
  ) {
    const id = crypto.randomUUID();
    const now = this.dateTime.nowISOString();
    const predicate =
      typeof condition === "string" ? sql.raw(condition) : condition.getSQL();
    return this.database.batch([
      sql`INSERT INTO automation_receipts (id, version, project_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, cursor, roster_complete, created_at, updated_at)
          VALUES (CASE WHEN (${predicate}) THEN ${id} ELSE NULL END, 0, ${projectId}, ${`guard:${id}`}, 'guard', 'claimed', ${`guard:${id}`}, 0, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)})`,
      ...statements,
      sql`DELETE FROM automation_receipts WHERE id = ${id}`,
    ]);
  }

  /**
   * Whether a guard holds right now. A failed `guarded` batch cannot say
   * whether its guard was false or the driver failed, and only the first is
   * a refusal a caller may skip; this asks the database the same question.
   */
  public async holds(condition: SQLLike): Promise<boolean> {
    const predicate =
      typeof condition === "string" ? sql.raw(condition) : condition.getSQL();
    const [rows] = await this.database.batch([
      sql`SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END AS held`,
    ]);
    return Number(rows[0]?.held) === 1;
  }
}
