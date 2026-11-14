import {
  type ProjectMergeChange,
  type ProjectMergeConflict,
  type ProjectMergeContext,
  ProjectMergeService,
  type ProjectMergeStepPlan,
  type ProjectMergeTable,
  ProjectMergeTables,
  projectMergeWrite,
  ProjectSecurityService,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository, type SQLLike } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { deployments } from "../entities/deployments.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { monitors } from "../entities/monitors.ts";
import { projectErrorIgnoreRules } from "../entities/projectErrorIgnoreRules.ts";
import { projectErrors } from "../entities/projectErrors.ts";
import { qualityRuns } from "../entities/qualityRuns.ts";
import { registryCredentials } from "../entities/registryCredentials.ts";
import { sigils } from "../entities/sigils.ts";
import { stackDeployments } from "../entities/stackDeployments.ts";
import { stacks } from "../entities/stacks.ts";
import { EstateService } from "./EstateService.ts";

/**
 * Deploy's step of a project merge, registered on core's
 * `ProjectMergeService` (#E94, #Q2782): every deployed copy, sigil, error,
 * artifact, stack, monitor and estate homed there moves into the target
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
 * for what only describes the project or repeats it: an estate it already
 * borrows, a registry it already logs in to, a day of coverage on a branch
 * it already measured, a build it was pushed too.
 */
export class DeployProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly estateService = $inject(EstateService);
  protected readonly estates = $repository(estates);

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
      // The estates the source is the home of (#Q3278): a slug is unique
      // per home project and never rewritten, since a machine's config may
      // record it, so one the target already holds is a conflict.
      kind: "estate",
      entity: estates,
      keys: ["slug"],
      onCollision: "refuse",
    },
    {
      kind: "estate loan",
      entity: estateProjects,
      keys: ["estateId"],
      onCollision: "keepTarget",
    },
    {
      kind: "registry credential",
      entity: registryCredentials,
      keys: ["host"],
      onCollision: "keepTarget",
    },
    {
      kind: "quality run",
      entity: qualityRuns,
      keys: ["branch", "day"],
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
    // The estates the source is the home of follow it (#Q3280): their cascade
    // anchor becomes the target's owner, in a statement after the move, and
    // a target with Apps off is a conflict, since nobody could manage them
    // there. Refused in the plan, so nothing is written.
    const homed = await this.estates.findMany({
      where: { projectId: { eq: context.sourceProjectId } },
      columns: ["id", "slug"],
    });
    if (homed.length > 0) {
      const capabilities = await this.projectSecurity.capabilitiesOf(
        context.targetProjectId,
      );
      if (!("apps" in capabilities)) {
        for (const estate of homed) {
          conflicts.push({
            kind: "estate",
            key: `${estate.slug} (Apps is off in the target)`,
            sourceId: estate.id,
            targetId: context.targetProjectId,
          });
        }
      }
      const owner = await this.estateService.ownerOf(context.targetProjectId);
      if (owner) {
        // Filtered on the TARGET, after the move, on purpose: by the time it
        // runs the source's homed estates belong to the target, and it
        // repoints them all. The target's own estates are rewritten to the
        // value they already hold, since `EstateAnchorHooks` keeps every
        // homed estate's `owner_user_id` on its home project's owner, so only
        // the moved ones change. `owner_user_id` is the cascade anchor
        // (#Q3278), not a stale owner column. It is a statement of the merge
        // batch (`updateStatement`), never an `estates.updateMany`, which
        // would run at once, outside the batch, and break its atomicity.
        statements.push(
          this.estates.updateStatement(
            { projectId: { eq: context.targetProjectId } },
            { ownerUserId: owner },
            projectMergeWrite,
          ),
        );
      }
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
