import { $inject } from "alepha";
import type { SQLLike } from "alepha/orm";

import { qualityRuns } from "../entities/qualityRuns.ts";
import {
  type ProjectMergeChange,
  type ProjectMergeConflict,
  type ProjectMergeContext,
  ProjectMergeService,
  type ProjectMergeStepPlan,
} from "./ProjectMergeService.ts";
import {
  type ProjectMergeTable,
  ProjectMergeTables,
} from "./ProjectMergeTables.ts";

/**
 * Quality's step of a project merge, registered on `ProjectMergeService`
 * (#E162, core's since #Q4217): the quality runs move into the target, and a
 * day of coverage on a branch the target already measured keeps the
 * target's row.
 */
export class QualityProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "quality run",
      entity: qualityRuns,
      keys: ["branch", "day"],
      onCollision: "keepTarget",
    },
  ];

  constructor() {
    this.tables.prepare(QualityProjectMerge.moved);
    this.merge.registerStep({
      order: 25,
      name: "quality",
      tables: QualityProjectMerge.moved.map((table) => table.entity.name),
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
    for (const table of QualityProjectMerge.moved) {
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
