import {
  type ProjectMergeChange,
  type ProjectMergeConflict,
  type ProjectMergeContext,
  ProjectMergeService,
  type ProjectMergeStepPlan,
  type ProjectMergeTable,
  ProjectMergeTables,
} from "@lore/core/api";
import { $inject } from "alepha";
import type { SQLLike } from "alepha/orm";

import { codeRepositories } from "../entities/codeRepositories.ts";
import { qualityRuns } from "../entities/qualityRuns.ts";

/**
 * Build's step of a project merge, registered on core's
 * `ProjectMergeService` (#E162): the quality runs move into the target, and
 * a day of coverage on a branch the target already measured keeps the
 * target's row.
 *
 * Repositories move too, by row only: `backendRef` names the backend's
 * repository by the ids it was created with, so nothing in the backend
 * moves. Two repositories under one slug are refused, a decision for a
 * person: one of them is renamed or deleted first.
 */
export class BuildProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "quality run",
      entity: qualityRuns,
      keys: ["branch", "day"],
      onCollision: "keepTarget",
    },
    {
      kind: "repository",
      entity: codeRepositories,
      keys: ["slug"],
      onCollision: "refuse",
    },
  ];

  constructor() {
    this.tables.prepare(BuildProjectMerge.moved);
    this.merge.registerStep({
      order: 25,
      name: "build",
      tables: BuildProjectMerge.moved.map((table) => table.entity.name),
      plan: (context) => this.plan(context),
    });
  }

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const moved: Record<string, number> = {};
    const changed: ProjectMergeChange[] = [];
    const conflicts: ProjectMergeConflict[] = [];
    const statements: SQLLike[] = [];
    for (const table of BuildProjectMerge.moved) {
      const result = await this.tables.move(context, table);
      moved[table.entity.name] = result.moved;
      changed.push(...result.changed);
      conflicts.push(...result.conflicts);
      statements.push(...result.statements);
    }
    return {
      moved,
      renumbered: [],
      joined: [],
      changed,
      conflicts,
      statements,
    };
  }
}
