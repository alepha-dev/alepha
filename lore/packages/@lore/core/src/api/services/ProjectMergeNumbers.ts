import { $inject } from "alepha";
import { SequenceProvider, sql, type SQLLike } from "alepha/orm";

import type {
  ProjectMergeRenumber,
  ProjectMergeSequence,
} from "./ProjectMergeService.ts";

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
  protected readonly sequences = $inject(SequenceProvider);

  /**
   * Answers the renumbered rows, the statements that apply them (one UPDATE
   * per renumbered row), and the target sequence to raise above every
   * number now in use. `table` and `column` are the moved rows' own; the
   * statements leave `project_id` alone, the caller moves the rows.
   *
   * The raise is not a statement of the batch: `ProjectMergeService` runs
   * it through `SequenceProvider.raise()` just before the batch, on a real
   * run only. It never lowers the sequence, so a batch that then fails
   * leaves a gap in the numbers, never a number handed out twice.
   */
  public async renumber(input: ProjectMergeNumbering): Promise<{
    renumbered: ProjectMergeRenumber[];
    statements: SQLLike[];
    sequences: ProjectMergeSequence[];
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
        sql`UPDATE ${sql.identifier(input.table)} SET ${sql.identifier(input.column)} = ${next} WHERE ${sql.identifier(input.idColumn ?? "id")} = ${row.id}`,
      );
    }
    const sequences =
      next > current ? [{ name: input.sequence, scope, atLeast: next }] : [];
    return { renumbered, statements, sequences };
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
   * The moved rows' primary key column, `id` unless named.
   */
  idColumn?: string;
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
