import { $inject, type ZObject } from "alepha";
import {
  type EntityPrimitive,
  type Repository,
  RepositoryProvider,
  type SQLLike,
} from "alepha/orm";

import { projectMergeWrite } from "../projectMergeWrite.ts";
import {
  type ProjectMergeChange,
  type ProjectMergeConflict,
  type ProjectMergeContext,
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
 * - `rename`: the source row keeps its data under a free name, `alerts (2)`,
 *   and the rename is reported. For a single text key that only labels the
 *   row, such as a notification channel's name (#Q3614).
 */
export class ProjectMergeTables {
  protected readonly repositories = $inject(RepositoryProvider);

  /**
   * Resolves the repository of every table a step moves. A step calls it
   * from its constructor, at boot: the container refuses a repository
   * first asked for once the app has started, and a table some module
   * never reads through a repository of its own would have none yet.
   */
  public prepare(tables: ProjectMergeTable[]): void {
    for (const table of tables) {
      this.repository(table);
    }
  }

  public repository(table: ProjectMergeTable): Repository<ZObject> {
    return this.repositories.getRepository(table.entity);
  }

  public async move(
    context: ProjectMergeContext,
    table: ProjectMergeTable,
  ): Promise<{
    moved: number;
    changed: ProjectMergeChange[];
    conflicts: ProjectMergeConflict[];
    statements: SQLLike[];
  }> {
    const repository = this.repository(table);
    const idField = table.idField ?? "id";
    const keys = table.keys ?? [];
    // `force`: a soft-deleted row moves too, and still holds its key.
    const read = (projectId: number) =>
      repository.findMany(
        {
          where: { projectId: { eq: projectId } },
          columns: [idField, ...keys, ...(table.read ?? [])],
        },
        { force: true },
      ) as Promise<Record<string, unknown>[]>;
    const keyOf = (row: Record<string, unknown>) =>
      keys.map((field) => this.text(row[field])).join(" / ");

    const source = await read(context.sourceProjectId);
    const changed: ProjectMergeChange[] = [];
    const conflicts: ProjectMergeConflict[] = [];
    const statements: SQLLike[] = [];
    let moved = source.length;

    if (keys.length) {
      const target = new Map(
        (await read(context.targetProjectId)).map((row) => [
          keyOf(row),
          this.text(row[idField]),
        ]),
      );
      for (const row of source) {
        const key = keyOf(row);
        const targetId = target.get(key);
        if (targetId === undefined) {
          continue;
        }
        const sourceId = this.text(row[idField]);
        const keep = table.keepTargetIf?.(row) ?? false;
        if (table.onCollision === "rename" && keys.length === 1 && !keep) {
          const taken = new Set([
            ...target.keys(),
            ...source.map((other) => keyOf(other)),
          ]);
          let free = key;
          for (let count = 2; taken.has(free); count++)
            free = table.renamed
              ? table.renamed(key, count)
              : `${key.slice(0, 56)} (${count})`;
          target.set(free, sourceId);
          changed.push({
            kind: table.kind,
            id: sourceId,
            field: keys[0],
            from: key,
            to: free,
          });
          statements.push(
            repository.updateStatement(
              { [idField]: { eq: row[idField] } } as never,
              { [keys[0]]: free } as never,
              projectMergeWrite,
            ),
          );
          continue;
        }
        if (table.onCollision === "keepTarget" || keep) {
          moved -= 1;
          changed.push({
            kind: table.kind,
            id: sourceId,
            field: "dropped",
            from: key,
            to: "",
          });
          statements.push(
            repository.deleteStatement(
              { [idField]: { eq: row[idField] } } as never,
              {
                force: true,
              },
            ),
          );
        } else {
          conflicts.push({ kind: table.kind, key, sourceId, targetId });
        }
      }
    }

    statements.push(
      repository.updateStatement(
        { projectId: { eq: context.sourceProjectId } } as never,
        { projectId: context.targetProjectId } as never,
        projectMergeWrite,
      ),
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
  /**
   * The table's entity: its rows are read through its repository, with
   * `force`, so soft-deleted ones count.
   */
  entity: EntityPrimitive<any>;
  /**
   * The primary key field, `id` unless named.
   */
  idField?: string;
  /**
   * The fields that, with `projectId`, are unique. Absent for a table
   * whose rows can never collide.
   */
  keys?: string[];
  onCollision?: "refuse" | "keepTarget" | "rename";
  /**
   * The free name a `rename` tries, for a key with a format of its own (an
   * automation's lowercase name, #Q4226). Default: `alerts (2)`.
   */
  renamed?: (key: string, count: number) => string;
  /**
   * A colliding source row this answers true for is dropped rather than
   * renamed: of two rows configuring the same built-in prompt, the
   * target's stands (#Q4274). It reads the fields `read` names.
   */
  keepTargetIf?: (row: Record<string, unknown>) => boolean;
  read?: string[];
}
