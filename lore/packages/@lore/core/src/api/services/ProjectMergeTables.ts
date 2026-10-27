import { $inject } from "alepha";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

import type {
  ProjectMergeChange,
  ProjectMergeConflict,
  ProjectMergeContext,
} from "./ProjectMergeService.ts";

/**
 * Moves a project-scoped table whose rows carry no per-project number
 * (#E94, #Q2782), for the merge steps of every module.
 *
 * A table with a unique key inside the project (`(project_id, app, env)`)
 * can hold a source row whose key the target already has. What to do then
 * is the table's own call, named by `onCollision`:
 *
 * - `refuse`: the plan reports a conflict and the merge refuses to run.
 *   For rows that ARE something (a sigil, a deployed copy, a stack): two
 *   of them under one key is a decision for a person, not for a script.
 * - `keepTarget`: the source row is dropped and the target's kept, and the
 *   drop is reported. For rows that only describe the project (a
 *   capability, a prompt, a day of coverage), where the target's answer is
 *   the one the merged project keeps.
 */
export class ProjectMergeTables {
  protected readonly database = $inject(DatabaseProvider);

  public async move(
    context: ProjectMergeContext,
    table: ProjectMergeTable,
  ): Promise<{
    moved: number;
    changed: ProjectMergeChange[];
    conflicts: ProjectMergeConflict[];
    statements: SQLLike[];
  }> {
    const idColumn = table.idColumn ?? "id";
    const keys = table.keys ?? [];
    const read = (projectId: number) =>
      this.database.execute(
        sql`SELECT ${sql.join(
          [idColumn, ...keys].map((column) => sql.identifier(column)),
          sql`, `,
        )} FROM ${sql.identifier(table.table)} WHERE project_id = ${projectId}`,
      );
    const keyOf = (row: Record<string, unknown>) =>
      keys.map((column) => this.text(row[column])).join(" / ");

    const source = await read(context.sourceProjectId);
    const changed: ProjectMergeChange[] = [];
    const conflicts: ProjectMergeConflict[] = [];
    const statements: SQLLike[] = [];
    let moved = source.length;

    if (keys.length) {
      const target = new Map(
        (await read(context.targetProjectId)).map((row) => [
          keyOf(row),
          this.text(row[idColumn]),
        ]),
      );
      for (const row of source) {
        const key = keyOf(row);
        const targetId = target.get(key);
        if (targetId === undefined) {
          continue;
        }
        const sourceId = this.text(row[idColumn]);
        if (table.onCollision === "keepTarget") {
          moved -= 1;
          changed.push({
            kind: table.kind,
            id: sourceId,
            field: "dropped",
            from: key,
            to: "",
          });
          statements.push(
            sql`DELETE FROM ${sql.identifier(table.table)} WHERE ${sql.identifier(idColumn)} = ${row[idColumn]}`,
          );
        } else {
          conflicts.push({ kind: table.kind, key, sourceId, targetId });
        }
      }
    }

    statements.push(
      sql`UPDATE ${sql.identifier(table.table)} SET project_id = ${context.targetProjectId} WHERE project_id = ${context.sourceProjectId}`,
    );
    return { moved, changed, conflicts, statements };
  }

  protected text(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    return "";
  }
}

/**
 * One project-scoped table, as `ProjectMergeTables.move` moves it.
 */
export interface ProjectMergeTable {
  /**
   * The kind named in the plan: `sigil`, `capability`, ...
   */
  kind: string;
  table: string;
  /**
   * The primary key column, `id` unless named.
   */
  idColumn?: string;
  /**
   * The columns that, with `project_id`, are unique. Absent for a table
   * whose rows can never collide.
   */
  keys?: string[];
  onCollision?: "refuse" | "keepTarget";
}
