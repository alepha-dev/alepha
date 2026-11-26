import { $inject, Alepha, z } from "alepha";
import {
  MemberService,
  organizationMembers,
  RankService,
} from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError, NotFoundError, okSchema } from "alepha/server";

import { displayName } from "../../web/app/services/displayName.ts";
import { projects } from "../entities/projects.ts";
import { coreRelations } from "../relations/coreRelations.ts";
import { adminProjectResourceSchema } from "../schemas/adminProjectResourceSchema.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectArchiveGuard } from "../services/ProjectArchiveGuard.ts";
import { ProjectDeletionService } from "../services/ProjectDeletionService.ts";

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
 *
 * ⚠️ An instance admin does not read inside a project they are not a member
 * of (#Q4538): every project gate answers them the 404 anybody gets. To get
 * in they join, with {@link AdminProjectController.adminJoinProject}, which
 * the project's Activity records for its members to see.
 */
export class AdminProjectController {
  /**
   * How long a project may go untouched before the list calls it dormant.
   *
   * Thirty days matches the retention window errors already use, so the two
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
  protected readonly ranks = $inject(RankService);
  protected readonly memberService = $inject(MemberService);
  protected readonly projectDeletion = $inject(ProjectDeletionService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

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
        /**
         * `"exclude"` = live projects only, `"only"` = archived ones only.
         * Absent means every project, archived included, as the page has
         * always listed them; anything else is no filter, like `activity`.
         */
        archived: z.string().optional(),
        /**
         * Created at or after this instant (inclusive).
         */
        createdFrom: z.datetime().optional(),
        /**
         * Created before this instant (exclusive), so two adjacent windows
         * never count a project twice.
         */
        createdTo: z.datetime().optional(),
      }),
      response: db.page(adminProjectResourceSchema),
    },
    handler: async ({ query, user }) => {
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

      if (query.archived === "exclude") {
        where.archivedAt = { isNull: true };
      } else if (query.archived === "only") {
        where.archivedAt = { isNotNull: true };
      }

      if (query.createdFrom || query.createdTo) {
        where.createdAt = {
          ...(query.createdFrom ? { gte: query.createdFrom } : {}),
          ...(query.createdTo ? { lt: query.createdTo } : {}),
        };
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
            columns: ["organizationId", "userId"],
          })
        : [];
      const joined = new Set(
        rows
          .filter((row) => row.userId === user.id)
          .map((row) => row.organizationId),
      );

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
          ownerUsername: project.owner ? displayName(project.owner) : undefined,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          memberCount: project.organizationId
            ? (memberCounts.get(project.organizationId) ?? 0)
            : 0,
          ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}),
          joined:
            !!project.organizationId && joined.has(project.organizationId),
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
  public readonly adminSetProjectArchived = $action({
    path: `${this.url}/:id/archive`,
    method: "POST",
    group: this.group,
    // The soft half of deleting (#Q4051): the same trust, and undone by
    // unarchiving.
    use: [$secure({ permissions: ["admin:project:delete"] })],
    description: "Archive a project: it stays, read-only",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ archived: z.boolean() }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const project = await this.projects.findById(params.id);
      if (!project) throw new NotFoundError("No such project");
      await this.alepha
        .inject(ProjectArchiveGuard)
        .setArchived(project, body.archived, user);
      return { ok: true };
    },
  });

  /**
   * The instance admin joins a project, in plain sight (#Q4538).
   *
   * The way in for an admin, who is otherwise refused inside a project like
   * any non-member, and what recovers a project nobody can manage any more.
   * The rank is `owner` when the project has none (its owner's account is
   * gone), so members can be managed and ownership handed on; otherwise the
   * `admin` rank, which manages members: a project has exactly one owner,
   * and only they can transfer it.
   *
   * The Activity row says it was an instance admin entering, not an
   * invitation accepted. Leaving is the project's ordinary leave.
   */
  public readonly adminJoinProject = $action({
    path: `${this.url}/:id/join`,
    method: "POST",
    group: this.group,
    use: [$secure({ permissions: ["admin:project:join"] })],
    description:
      "Join a project as an instance admin, recorded in its activity",
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.object({ rank: z.text() }),
    },
    handler: async ({ params, user }) => {
      const project = await this.projects.findById(params.id);
      if (!project?.organizationId) throw new NotFoundError("No such project");
      const organizationId = project.organizationId;

      const existing = await this.members.findMany({
        where: { organizationId: { eq: organizationId } },
        columns: ["userId", "rank"],
      });
      if (existing.some((member) => member.userId === user.id)) {
        throw new ConflictError("You are already a member of this project");
      }

      const hasOwner = existing.some(
        (member) => member.rank === MemberService.OWNER,
      );
      const defined = await this.ranks.ranksOf(organizationId);
      let rank: string = MemberService.OWNER;
      if (hasOwner) {
        rank = defined.some((it) => it.key === "admin")
          ? "admin"
          : MemberService.MEMBER;
        await this.memberService.add(organizationId, user.id, rank, user);
      } else {
        await this.memberService.addOwner(organizationId, user.id);
      }
      // The rank as the project names it, frozen on the row: a rank renamed
      // later does not rewrite what members read happened.
      const rankName =
        defined.find((it) => it.key === rank)?.name ??
        (rank === MemberService.OWNER ? "Owner" : rank);

      await this.audits.member.logSuccess("join", {
        ...this.audits.actor(user),
        ...this.audits.scope(project.id),
        severity: "warning",
        resourceType: "project",
        resourceId: String(project.id),
        description: project.title,
        metadata: { instanceAdmin: true, rank, rankName },
      });
      return { rank };
    },
  });

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
}
