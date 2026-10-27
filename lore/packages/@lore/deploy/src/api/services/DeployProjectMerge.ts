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

/**
 * Deploy's step of a project merge, registered on core's
 * `ProjectMergeService` (#E94, #Q2782): every deployed copy, sigil, blight,
 * artifact, stack and monitor moves into the target project.
 *
 * Only the tables keyed by the project move: everything below them
 * (a sigil's analytics and error groups, an instance's secrets, a stack's
 * revisions and environments, a monitor's heartbeats) is keyed by its
 * parent's global id and follows it. That is what lets a sigil move while
 * its app keeps reporting: its token is unchanged, and every row ingest
 * writes is reached through the sigil, not the project.
 *
 * A unique key the target already holds is refused for what a row IS (a
 * deployed copy, a sigil, a stack, a blight), and the target's row kept
 * for what only describes the project or repeats it: an estate it already
 * borrows, a registry it already logs in to, a day of coverage on a branch
 * it already measured, a build it was pushed too.
 */
export class DeployProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "sigil",
      table: "sigils",
      keys: ["name"],
      onCollision: "refuse",
    },
    {
      kind: "app instance",
      table: "app_instances",
      keys: ["app", "env"],
      onCollision: "refuse",
    },
    {
      // A build key held by both projects is ONE build pushed twice: a
      // version tag moves only under `--force`, and `latest` always names the
      // newest push, which is the target's once CI reports there. The
      // source's row goes; its bytes stay in the bucket, unreferenced.
      kind: "artifact",
      table: "artifacts",
      keys: ["app", "tag", "runtime", "format"],
      onCollision: "keepTarget",
    },
    {
      kind: "blight",
      table: "blights",
      keys: ["fingerprint"],
      onCollision: "refuse",
    },
    { kind: "blight ignore rule", table: "blight_ignore_rules" },
    { kind: "deployment", table: "deployments" },
    {
      kind: "stack",
      table: "stacks",
      keys: ["name"],
      onCollision: "refuse",
    },
    { kind: "stack deployment", table: "stack_deployments" },
    { kind: "monitor", table: "monitors" },
    {
      kind: "estate loan",
      table: "estate_projects",
      keys: ["estate_id"],
      onCollision: "keepTarget",
    },
    {
      kind: "registry credential",
      table: "registry_credentials",
      keys: ["host"],
      onCollision: "keepTarget",
    },
    {
      kind: "quality run",
      table: "quality_runs",
      keys: ["branch", "day"],
      onCollision: "keepTarget",
    },
  ];

  constructor() {
    this.merge.registerStep({
      order: 30,
      name: "deploy",
      tables: DeployProjectMerge.moved.map((table) => table.table),
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
    for (const table of DeployProjectMerge.moved) {
      const result = await this.tables.move(context, table);
      moved[table.table] = result.moved;
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
