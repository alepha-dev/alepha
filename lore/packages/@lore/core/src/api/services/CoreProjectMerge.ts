import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

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
 * project itself, and its automations.
 *
 * - **Capabilities and prompts**: the target keeps its own; a capability or
 *   a customised prompt it lacks comes over, so the merged project does
 *   everything both did.
 * - **Automations** move whole, every table keyed by the project with them.
 *   A shared variable or an adopted policy the target already has is a
 *   conflict: two rules depending on one key is a person's call.
 * - **Members**: a source member who is not a target member joins the
 *   target's organization. Their rank comes too when the target defines
 *   it; `owner` never does, since ownership is transferred and never
 *   assigned, and a rank the target lacks becomes `member`.
 * - **Dashboard cards stay** in the source: a dashboard is laid out for one
 *   project, and the target's own is the one the merged project shows.
 */
export class CoreProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "capability",
      table: "project_capabilities",
      keys: ["key"],
      onCollision: "keepTarget",
    },
    {
      kind: "prompt",
      table: "project_prompts",
      keys: ["kind"],
      onCollision: "keepTarget",
    },
    { kind: "automation", table: "automations" },
    {
      kind: "automation variable",
      table: "automation_variables",
      keys: ["key"],
      onCollision: "refuse",
    },
    {
      kind: "automation adoption",
      table: "automation_adoptions",
      keys: ["policy"],
      onCollision: "refuse",
    },
    {
      kind: "automation event",
      table: "automation_events",
      keys: ["identity"],
      onCollision: "refuse",
    },
    {
      kind: "automation receipt",
      table: "automation_receipts",
      keys: ["identity"],
      onCollision: "refuse",
    },
    { kind: "automation run", table: "automation_runs" },
  ];

  constructor() {
    this.merge.registerStep({
      order: 5,
      name: "core",
      tables: [
        ...CoreProjectMerge.moved.map((table) => table.table),
        // Stays with the source: see the class comment.
        "project_dashboard_cards",
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
      moved[table.table] = result.moved;
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
    const organizationOf = async (projectId: number) => {
      const rows = await this.database.execute(
        sql`SELECT organization_id FROM projects WHERE id = ${projectId}`,
      );
      const id = rows[0]?.organization_id;
      return typeof id === "string" ? id : undefined;
    };
    const source = await organizationOf(context.sourceProjectId);
    const target = await organizationOf(context.targetProjectId);
    if (!source || !target) {
      return { changed: [], statements: [] };
    }
    const members = async (organizationId: string) =>
      (
        await this.database.execute(
          sql`SELECT user_id, rank FROM organization_members WHERE organization_id = ${organizationId}`,
        )
      ).map((row) => ({
        userId: String(row.user_id),
        rank: typeof row.rank === "string" ? row.rank : undefined,
      }));
    const present = new Set((await members(target)).map((row) => row.userId));
    const ranks = new Set(
      (
        await this.database.execute(
          sql`SELECT key FROM organization_ranks WHERE organization_id = ${target}`,
        )
      ).map((row) => String(row.key)),
    );

    const now = this.dateTime.nowISOString();
    const at =
      this.database.dialect === "sqlite" ? new Date(now).getTime() : now;
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
      statements.push(
        sql`INSERT INTO organization_members (id, created_at, updated_at, organization_id, user_id, rank) VALUES (${crypto.randomUUID()}, ${at}, ${at}, ${target}, ${member.userId}, ${rank})`,
      );
    }
    return { changed, statements };
  }
}
