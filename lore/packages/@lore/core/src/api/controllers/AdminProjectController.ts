import { $inject, z } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { coreRelations } from "../relations/coreRelations.ts";
import { adminProjectResourceSchema } from "../schemas/adminProjectResourceSchema.ts";
import { projectMergeResultSchema } from "../schemas/projectMergeResultSchema.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectDeletionService } from "../services/ProjectDeletionService.ts";
import { ProjectMergeReport } from "../services/ProjectMergeReport.ts";
import { ProjectMergeService } from "../services/ProjectMergeService.ts";

/**
 * Instance-wide view of every project, for the admin shell.
 *
 * Lore's project endpoints are all member-scoped — `assertMember` or
 * `assertOwner` — which is correct for the application and useless for an
 * operator who needs to see what exists on the instance at all. This
 * controller is the deliberate exception, and it is narrow on purpose: it
 * lists projects and counts their members, and exposes nothing of what is
 * inside them. There is no admin read of quests, folios or feedback here,
 * and adding one should be a separate decision rather than a natural
 * extension of this file.
 *
 * Gated on `admin:project:read`, matching the `admin:<thing>:<verb>` shape
 * `AdminInvitationController` and the framework's own admin controllers use.
 */
export class AdminProjectController {
  /**
   * How long a project may go untouched before the list calls it dormant.
   *
   * Thirty days matches the retention window blights already use, so the two
   * "is this still alive" judgements in the app agree rather than each picking
   * their own number.
   */
  protected readonly ACTIVITY_WINDOW_DAYS = 30;

  protected readonly url = "/admin/projects";
  protected readonly group = "admin:projects";
  protected readonly projects = $repository(projects);
  /**
   * Relation-aware view of the same table, for the owner JOIN.
   */
  protected readonly projectsWith = $repository(coreRelations, "projects");
  protected readonly members = $repository(organizationMembers);
  protected readonly projectDeletion = $inject(ProjectDeletionService);
  protected readonly projectMerge = $inject(ProjectMergeService);
  protected readonly mergeReport = $inject(ProjectMergeReport);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);

  public readonly findProjects = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:project:read"] })],
    description: "List every project on this instance, newest first",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        /**
         * `"active"` = touched within {@link AdminProjectController.ACTIVITY_WINDOW_DAYS}; `"dormant"`
         * = not touched since. Anything else, including absent, means no
         * filter — a free-form string rather than an enum so a stale value
         * from a persisted filter bar falls back to "all" instead of throwing.
         */
        activity: z.string().optional(),
      }),
      response: db.page(adminProjectResourceSchema),
    },
    handler: async ({ query }) => {
      const where = this.projects.createQueryWhere();

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }

      /*
       * Activity is the filter this page exists to support alongside its
       * delete actions: "what is dormant enough to clean up". Computed from
       * `updatedAt` against a fixed window rather than exposing a date picker
       * — an operator asks "is this still in use", not "was this touched
       * between two exact dates".
       */
      if (query.activity === "active" || query.activity === "dormant") {
        const cutoff = this.dateTime
          .now()
          .subtract(this.ACTIVITY_WINDOW_DAYS, "days")
          .toISOString();
        where.updatedAt =
          query.activity === "active" ? { gte: cutoff } : { lt: cutoff };
      }

      query.sort ??= "-createdAt";

      /*
       * `include: { owner: true }` is a JOIN, declared once in
       * `relations/coreRelations.ts` rather than hand-rolled here — the file's own rule is
       * that the entity graph joins there and not in a controller.
       *
       * The alternative was resolving `createdBy` in a second query. That
       * works, but it puts a copy of the projects→users edge in this file,
       * where nothing keeps it agreeing with the schema.
       */
      const result = await this.projectsWith.paginate(
        query,
        { where, include: { owner: true } },
        { count: true },
      );

      // Two extra queries for the whole page, not two per row. `content` is a
      // single page (20 by default), so both `inArray` lists stay small and
      // the cost does not grow with the size of the table.
      const organizationIds = result.content.flatMap((project) =>
        project.organizationId ? [project.organizationId] : [],
      );
      const rows = organizationIds.length
        ? await this.members.findMany({
            where: { organizationId: { inArray: organizationIds } },
            columns: ["organizationId"],
          })
        : [];

      const memberCounts = new Map<string, number>();
      for (const row of rows) {
        memberCounts.set(
          row.organizationId,
          (memberCounts.get(row.organizationId) ?? 0) + 1,
        );
      }

      return {
        ...result,
        content: result.content.map((project) => ({
          id: project.id,
          title: project.title,
          createdBy: project.createdBy,
          ownerUsername: project.owner?.username ?? project.owner?.email,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          memberCount: project.organizationId
            ? (memberCounts.get(project.organizationId) ?? 0)
            : 0,
        })),
      };
    },
  });

  /**
   * Delete one project and its dependents.
   *
   * Separate permission from `admin:project:read` on purpose: seeing what
   * exists on the instance and being able to erase it are different levels of
   * trust, and this is the most destructive action in the application.
   */
  public readonly deleteProject = $action({
    path: `${this.url}/:id`,
    method: "DELETE",
    group: this.group,
    use: [$secure({ permissions: ["admin:project:delete"] })],
    description: "Delete a project and its members and quests",
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const deleted = await this.projectDeletion.deleteProject(params.id);
      // Same row shape as the owner's own delete, so the two read alike in
      // the log: only the actor differs.
      if (deleted) {
        await this.audits.project.logSuccess("delete", {
          ...this.audits.actor(user),
          severity: "warning",
          resourceType: "project",
          resourceId: String(deleted.id),
          description: deleted.title,
        });
      }
      return { ok: true };
    },
  });

  /**
   * Delete several projects in one call, for the table's checkbox selection.
   *
   * Reports the ids it actually deleted rather than assuming the whole input
   * succeeded — the caller uses that to tell the operator how much went, and a
   * silent partial failure on a destructive bulk action is exactly the kind of
   * thing that should not be inferred from a 200.
   */
  public readonly deleteProjects = $action({
    path: this.url,
    method: "DELETE",
    group: this.group,
    use: [$secure({ permissions: ["admin:project:delete"] })],
    description: "Delete several projects and their members and quests",
    schema: {
      body: z.object({
        ids: z.array(z.integer()).min(1),
      }),
      response: z.object({
        deleted: z.array(z.integer()),
      }),
    },
    handler: async ({ body, user }) => {
      const deleted: number[] = [];
      for (const id of body.ids) {
        const gone = await this.projectDeletion.deleteProject(id);
        if (gone) {
          // One row per project, not one for the batch: the log is read to
          // answer "what happened to THIS project".
          await this.audits.project.logSuccess("delete", {
            ...this.audits.actor(user),
            severity: "warning",
            resourceType: "project",
            resourceId: String(gone.id),
            description: gone.title,
          });
        }
        deleted.push(id);
      }
      return { deleted };
    },
  });

  /**
   * Merge one project into another (#E94, #Q2783, folio #F1401): every
   * row of the source moves into the target, a per-project number the
   * target already uses is renumbered, and the references in moved text
   * follow. A **dry run by default**: the caller reads the plan, conflicts
   * included, before anything is written.
   *
   * Gated on `admin:project:delete`, the permission that may already empty
   * a project, because a merge leaves the source empty. The caller archives
   * the source afterwards; nothing here deletes a project row.
   */
  public readonly mergeProject = $action({
    path: `${this.url}/:id/merge`,
    method: "POST",
    group: this.group,
    use: [$secure({ permissions: ["admin:project:delete"] })],
    description:
      "Merge a project into another, renumbering what collides (dry run unless dryRun is false)",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        target: z.integer(),
        dryRun: z.boolean().optional(),
      }),
      response: projectMergeResultSchema,
    },
    handler: async ({ params, body, user }) => {
      const dryRun = body.dryRun !== false;
      const source = await this.projects.findById(params.id);
      const target = await this.projects.findById(body.target);
      const plan = await this.projectMerge.merge(params.id, body.target, {
        dryRun,
      });
      if (!dryRun) {
        await this.audits.project.logSuccess("merge", {
          ...this.audits.actor(user),
          severity: "warning",
          resourceType: "project",
          resourceId: String(body.target),
          description: `${source?.title ?? params.id} merged into ${target?.title ?? body.target}`,
        });
      }
      return {
        ...plan,
        report: this.mergeReport.markdown(plan, {
          source: source?.title ?? String(params.id),
          target: target?.title ?? String(body.target),
          at: this.dateTime.nowISOString(),
        }),
      };
    },
  });
}
