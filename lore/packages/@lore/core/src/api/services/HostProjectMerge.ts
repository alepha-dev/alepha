import { $inject } from "alepha";
import { $repository, type SQLLike } from "alepha/orm";

import { hostProjects } from "../entities/hostProjects.ts";
import { hosts } from "../entities/hosts.ts";
import { projectMergeWrite } from "../projectMergeWrite.ts";
import { HostService } from "./HostService.ts";
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
 * The hosts' step of a project merge, core's since #E166 (#Q4099): the hosts
 * the source is the home of and the loans it holds follow it into the
 * target, whatever the target's capabilities. A host works with Ship off, so
 * a target without Ship is no conflict any more.
 */
export class HostProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);
  protected readonly hostService = $inject(HostService);
  protected readonly hosts = $repository(hosts);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      // The hosts the source is the home of (#Q3278): a slug is unique
      // per home project and never rewritten, since a machine's config may
      // record it, so one the target already holds is a conflict.
      kind: "host",
      entity: hosts,
      keys: ["slug"],
      onCollision: "refuse",
    },
    {
      kind: "host loan",
      entity: hostProjects,
      keys: ["hostId"],
      onCollision: "keepTarget",
    },
  ];

  constructor() {
    this.tables.prepare(HostProjectMerge.moved);
    this.merge.registerStep({
      // Right after Ship's step, where the host tables moved before #E166.
      order: 31,
      name: "hosts",
      tables: HostProjectMerge.moved.map((table) => table.entity.name),
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
    for (const table of HostProjectMerge.moved) {
      const result = await this.tables.move(context, table);
      moved[table.entity.name] = result.moved;
      changed.push(...result.changed);
      conflicts.push(...result.conflicts);
      statements.push(...result.statements);
    }
    // The hosts the source is the home of follow it (#Q3280): their cascade
    // anchor becomes the target's owner, in a statement after the move.
    const homed = await this.hosts.findMany({
      where: { projectId: { eq: context.sourceProjectId } },
      columns: ["id"],
    });
    if (homed.length > 0) {
      const owner = await this.hostService.ownerOf(context.targetProjectId);
      if (owner) {
        // Filtered on the TARGET, after the move, on purpose: by the time it
        // runs the source's homed hosts belong to the target, and it
        // repoints them all. The target's own hosts are rewritten to the
        // value they already hold, since `HostAnchorHooks` keeps every
        // homed host's `owner_user_id` on its home project's owner, so only
        // the moved ones change. `owner_user_id` is the cascade anchor
        // (#Q3278), not a stale owner column. It is a statement of the merge
        // batch (`updateStatement`), never an `hosts.updateMany`, which
        // would run at once, outside the batch, and break its atomicity.
        statements.push(
          this.hosts.updateStatement(
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
