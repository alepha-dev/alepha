import { $inject } from "alepha";
import {
  organizationMembers,
  organizationRanks,
} from "alepha/api/organizations";
import { $repository, type SQLLike } from "alepha/orm";

import { agentAutomations } from "../entities/agentAutomations.ts";
import { eventSubscriptions } from "../entities/eventSubscriptions.ts";
import { notificationChannels } from "../entities/notificationChannels.ts";
import { projectCapabilities } from "../entities/projectCapabilities.ts";
import { projectEvents } from "../entities/projectEvents.ts";
import { projectPrompts } from "../entities/projectPrompts.ts";
import { projects } from "../entities/projects.ts";
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
 * Core's step of a project merge (#E94, #Q2782): the rows that describe the
 * project itself, its events, who is notified of them, and its channels.
 *
 * - **Capabilities and prompts**: the target keeps its own; a capability or
 *   a customised prompt it lacks comes over, so the merged project does
 *   everything both did.
 * - **Agent automations** move, renamed on a clash (#Q4226).
 * - **Events, subscriptions and channels** move (#Q3889, #Q3890): a
 *   subscription the target already has joins it, a channel name it already
 *   uses gets a free one.
 * - **Members**: a source member who is not a target member joins the
 *   target's organization. Their rank comes too when the target defines
 *   it; `owner` never does, since ownership is transferred and never
 *   assigned, and a rank the target lacks becomes `member`.
 * - **Dashboards and their cards stay** in the source: a dashboard is laid
 *   out for one project, and the target's own are the ones the merged
 *   project shows. Moving them cannot be an `UPDATE project_id` alone: a
 *   stored card's scope holds its project's id, so every moved card would
 *   still point at the source (#Q3298).
 */
export class CoreProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);
  protected readonly ranks = $repository(organizationRanks);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "capability",
      entity: projectCapabilities,
      keys: ["key"],
      onCollision: "keepTarget",
    },
    {
      kind: "prompt",
      entity: projectPrompts,
      keys: ["kind"],
      onCollision: "keepTarget",
    },
    // A merged project keeps the source's recent events (#Q3889) and who
    // is told of them (#Q3890): a duplicate subscription joins the target's.
    { kind: "project event", entity: projectEvents },
    {
      kind: "subscription",
      entity: eventSubscriptions,
      keys: ["key"],
      onCollision: "keepTarget",
    },
    // A configured channel moves with its sealed URL; a name the target
    // already uses gets a free one (#Q3614).
    {
      kind: "notification channel",
      entity: notificationChannels,
      keys: ["name"],
      onCollision: "rename",
    },
    // Agent automations (#Q4226) move with the project they run for; a
    // name the target already uses gets a free one. Their jobs stay: a run
    // is the source's, as it ran.
    {
      kind: "agent automation",
      entity: agentAutomations,
      keys: ["name"],
      onCollision: "rename",
      renamed: (key, count) => `${key.slice(0, 44)}-${count}`,
    },
  ];

  constructor() {
    this.tables.prepare(CoreProjectMerge.moved);
    this.merge.registerStep({
      order: 5,
      name: "core",
      tables: [
        ...CoreProjectMerge.moved.map((table) => table.entity.name),
        // Stays with the source: see the class comment.
        "project_dashboard_cards",
        "project_dashboards",
      ],
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
    for (const table of CoreProjectMerge.moved) {
      const result = await this.tables.move(context, table);
      moved[table.entity.name] = result.moved;
      changed.push(...result.changed);
      conflicts.push(...result.conflicts);
      statements.push(...result.statements);
    }
    const members = await this.planMembers(context);
    moved.organization_members = members.changed.length;
    changed.push(...members.changed);
    statements.push(...members.statements);
    return {
      moved,
      renumbered: [],
      joined: [],
      changed,
      conflicts,
      statements,
    };
  }

  protected async planMembers(context: ProjectMergeContext): Promise<{
    changed: ProjectMergeChange[];
    statements: SQLLike[];
  }> {
    const organizationOf = async (projectId: number) =>
      (await this.projects.findById(projectId, { force: true }))
        ?.organizationId ?? undefined;
    const source = await organizationOf(context.sourceProjectId);
    const target = await organizationOf(context.targetProjectId);
    if (!source || !target) {
      return { changed: [], statements: [] };
    }
    const members = (organizationId: string) =>
      this.members.findMany(
        {
          where: { organizationId: { eq: organizationId } },
          columns: ["userId", "rank"],
        },
        { force: true },
      );
    const present = new Set((await members(target)).map((row) => row.userId));
    const ranks = new Set(
      (
        await this.ranks.findMany(
          { where: { organizationId: { eq: target } }, columns: ["key"] },
          { force: true },
        )
      ).map((row) => row.key),
    );

    const changed: ProjectMergeChange[] = [];
    const statements: SQLLike[] = [];
    for (const member of await members(source)) {
      if (present.has(member.userId)) {
        continue;
      }
      const rank =
        member.rank && member.rank !== "owner" && ranks.has(member.rank)
          ? member.rank
          : "member";
      changed.push({
        kind: "member",
        id: member.userId,
        field: "rank",
        from: member.rank ?? "",
        to: rank,
      });
      // The ORM gives the row its id and timestamps.
      statements.push(
        this.members.insertStatement({
          organizationId: target,
          userId: member.userId,
          rank,
        }),
      );
    }
    return { changed, statements };
  }
}
