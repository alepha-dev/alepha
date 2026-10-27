import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  DatabaseProvider,
  SequenceProvider,
  sql,
  type SQLLike,
} from "alepha/orm";

import type { ProjectMergeRenumber } from "./ProjectMergeService.ts";

/**
 * Gives a moved item a new per-project number when its own is taken in the
 * target project (#E94, folio #F1401), for every merge step that moves a
 * numbered kind (`#Q`, `#E`, `#P`, `#F`, ...).
 *
 * An item whose number is free keeps it, so a reference written before the
 * projects were split keeps meaning the same item. A taken one gets a
 * number above everything either project uses and above the target's
 * sequence, in the order the caller lists the rows (their creation order):
 * above the SOURCE's numbers too, or a renumbered item could land on the
 * number of a source item that keeps its own.
 */
export class ProjectMergeNumbers {
  protected readonly database = $inject(DatabaseProvider);
  protected readonly sequences = $inject(SequenceProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Answers the renumbered rows and the statements that apply them: one
   * UPDATE per renumbered row, and the target sequence raised above every
   * number now in use. `table` and `column` are the moved rows' own; the
   * statements leave `project_id` alone, the caller moves the rows.
   */
  public async renumber(input: ProjectMergeNumbering): Promise<{
    renumbered: ProjectMergeRenumber[];
    statements: SQLLike[];
  }> {
    const taken = new Set(input.targetNumbers);
    const scope = String(input.targetProjectId);
    const current = (await this.sequences.peek(input.sequence, scope)) ?? 0;
    let next = Math.max(
      current,
      ...input.targetNumbers,
      ...input.sourceRows.map((row) => row.number),
    );
    const renumbered: ProjectMergeRenumber[] = [];
    const statements: SQLLike[] = [];
    for (const row of input.sourceRows) {
      if (!taken.has(row.number)) {
        continue;
      }
      next += 1;
      renumbered.push({
        kind: input.kind,
        id: row.id,
        from: row.number,
        to: next,
      });
      statements.push(
        sql`UPDATE ${sql.identifier(input.table)} SET ${sql.identifier(input.column)} = ${next} WHERE id = ${row.id}`,
      );
    }
    if (next > current) {
      statements.push(this.raiseSequence(input.sequence, scope, next));
    }
    return { renumbered, statements };
  }

  /**
   * Sets a sequence to at least `value`, creating its row when the target
   * never allocated one. Never lowers it: a number handed out after the plan
   * was read stays below the next one.
   */
  protected raiseSequence(name: string, scope: string, value: number): SQLLike {
    const now = this.dateTime.nowISOString();
    const at =
      this.database.dialect === "sqlite" ? new Date(now).getTime() : now;
    const highest =
      this.database.dialect === "sqlite"
        ? sql`MAX(alepha_sequences.value, excluded.value)`
        : sql`GREATEST(alepha_sequences.value, excluded.value)`;
    return sql`INSERT INTO alepha_sequences (id, name, scope, value, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${name}, ${scope}, ${value}, ${at}, ${at})
      ON CONFLICT (name, scope) DO UPDATE SET value = ${highest}, updated_at = excluded.updated_at`;
  }
}

/**
 * What `ProjectMergeNumbers.renumber` needs to know about one numbered kind.
 */
export interface ProjectMergeNumbering {
  /**
   * The kind named in the mapping: `quest`, `epic`, `feedback`, ...
   */
  kind: string;
  table: string;
  column: string;
  /**
   * The `$sequence` that allocates this number, scoped by project id.
   */
  sequence: string;
  targetProjectId: number;
  /**
   * Every number the target uses, soft-deleted rows included: a unique
   * index on `(project_id, number)` still counts them.
   */
  targetNumbers: number[];
  /**
   * The moved rows, in their creation order.
   */
  sourceRows: Array<{ id: number | string; number: number }>;
}
