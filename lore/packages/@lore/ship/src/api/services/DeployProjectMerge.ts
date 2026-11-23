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
import { type SQLLike } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { deployments } from "../entities/deployments.ts";
import { monitors } from "../entities/monitors.ts";
import { projectErrorIgnoreRules } from "../entities/projectErrorIgnoreRules.ts";
import { projectErrors } from "../entities/projectErrors.ts";
import { registryCredentials } from "../entities/registryCredentials.ts";
import { sigils } from "../entities/sigils.ts";
import { stackDeployments } from "../entities/stackDeployments.ts";
import { stacks } from "../entities/stacks.ts";

/**
 * Deploy's step of a project merge, registered on core's
 * `ProjectMergeService` (#E94, #Q2782): every deployed copy, sigil, error,
 * artifact, stack, monitor and host homed there moves into the target
 * project.
 *
 * Only the tables keyed by the project move: everything below them
 * (a sigil's analytics and error groups, an instance's secrets, a stack's
 * revisions and environments, a monitor's heartbeats) is keyed by its
 * parent's global id and follows it. That is what lets a sigil move while
 * its app keeps reporting: its token is unchanged, and every row ingest
 * writes is reached through the sigil, not the project.
 *
 * A unique key the target already holds is refused for what a row IS (a
 * deployed copy, a sigil, a stack, an error), and the target's row kept
 * for what only describes the project or repeats it: a host it already
 * borrows, a registry it already logs in to, a build it was pushed too.
 * Quality runs are Build's step since #E162.
 */
export class DeployProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "sigil",
      entity: sigils,
      keys: ["name"],
      onCollision: "refuse",
    },
    {
      kind: "app instance",
      entity: appInstances,
      keys: ["app", "env"],
      onCollision: "refuse",
    },
    {
      // A build key held by both projects is ONE build pushed twice: a
      // version tag moves only under `--force`, and `latest` always names the
      // newest push, which is the target's once CI reports there. The
      // source's row goes; its bytes stay in the bucket, unreferenced.
      kind: "artifact",
      entity: artifacts,
      keys: ["app", "tag", "runtime", "format"],
      onCollision: "keepTarget",
    },
    {
      kind: "error",
      entity: projectErrors,
      keys: ["fingerprint"],
      onCollision: "refuse",
    },
    { kind: "error ignore rule", entity: projectErrorIgnoreRules },
    { kind: "deployment", entity: deployments },
    {
      kind: "stack",
      entity: stacks,
      keys: ["name"],
      onCollision: "refuse",
    },
    { kind: "stack deployment", entity: stackDeployments },
    { kind: "monitor", entity: monitors },
    {
      kind: "registry credential",
      entity: registryCredentials,
      keys: ["host"],
      onCollision: "keepTarget",
    },
  ];

  constructor() {
    this.tables.prepare(DeployProjectMerge.moved);
    this.merge.registerStep({
      order: 30,
      name: "deploy",
      tables: DeployProjectMerge.moved.map((table) => table.entity.name),
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
