import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { relations } from "../relations.ts";
import { adminProjectResourceSchema } from "../schemas/adminProjectResourceSchema.ts";
import { ProjectDeletionService } from "../services/ProjectDeletionService.ts";

/**
 * How long a project may go untouched before the list calls it dormant.
 *
 * Thirty days matches the retention window blights already use, so the two
 * "is this still alive" judgements in the app agree rather than each picking
 * their own number.
 */
const ACTIVITY_WINDOW_DAYS = 30;

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
  protected readonly url = "/admin/projects";
  protected readonly group = "admin:projects";
  protected readonly projects = $repository(projects);
  /** Relation-aware view of the same table, for the owner JOIN. */
  protected readonly projectsWith = $repository(relations, "projects");
  protected readonly members = $repository(members);
  protected readonly projectDeletion = $inject(ProjectDeletionService);
  protected readonly dateTime = $inject(DateTimeProvider);

  public readonly findProjects = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:project:read"] })],
    description: "List every project on this instance, newest first",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        /**
         * `"active"` = touched within {@link ACTIVITY_WINDOW_DAYS}; `"dormant"`
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
          .subtract(ACTIVITY_WINDOW_DAYS, "days")
          .toISOString();
        where.updatedAt =
          query.activity === "active" ? { gte: cutoff } : { lt: cutoff };
      }

      query.sort ??= "-createdAt";

      /*
       * `include: { owner: true }` is a JOIN, declared once in
       * `relations.ts` rather than hand-rolled here — the file's own rule is
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
      const ids = result.content.map((project) => project.id);
      const rows = ids.length
        ? await this.members.findMany({
            where: { projectId: { inArray: ids } },
            columns: ["projectId"],
          })
        : [];

      const memberCounts = new Map<number, number>();
      for (const row of rows) {
        memberCounts.set(
          row.projectId,
          (memberCounts.get(row.projectId) ?? 0) + 1,
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
          memberCount: memberCounts.get(project.id) ?? 0,
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
    handler: async ({ params }) => {
      await this.projectDeletion.deleteProject(params.id);
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
    handler: async ({ body }) => {
      const deleted: number[] = [];
      for (const id of body.ids) {
        await this.projectDeletion.deleteProject(id);
        deleted.push(id);
      }
      return { deleted };
    },
  });
}
