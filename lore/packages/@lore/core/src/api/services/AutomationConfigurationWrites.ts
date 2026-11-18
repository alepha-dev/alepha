import { $inject } from "alepha";
import { sql, type SQLLike } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { GuardedBatch } from "./GuardedBatch.ts";
import { LoreDatabase } from "./LoreDatabase.ts";

/**
 * A failed native precondition is a public conflict. Genuine write/audit
 * failures retain their error and roll back the entire configuration mutation.
 */
export class AutomationConfigurationWrites {
  protected readonly atomic = $inject(GuardedBatch);
  protected readonly database = $inject(LoreDatabase);
  public async commit(
    projectId: number,
    condition: SQLLike,
    statements: SQLLike[],
  ) {
    try {
      return await this.atomic.guarded(condition, statements);
    } catch (error) {
      const predicate =
        typeof condition === "string" ? sql.raw(condition) : condition.getSQL();
      const [rows] = await this.database.batch([
        sql`SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END AS valid`,
      ]);
      if (Number(rows[0]?.valid) !== 1)
        throw new ConflictError(
          "Automation configuration changed; reload before writing",
        );
      throw error;
    }
  }
}
