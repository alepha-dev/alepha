import { $inject, Alepha, z } from "alepha";
import { $storage, files } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema } from "alepha/orm";
import {
  $owns,
  $secure,
  OwnedResourceProvider,
  type UserAccountToken,
} from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";
import { type Member, members } from "../entities/members.ts";
import { milestones } from "../entities/milestones.ts";
import {
  defaultProjectFeatures,
  type Project,
  projectFeaturesSchema,
  projects,
} from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { relations } from "../relations.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { ProjectDeletionService } from "../services/ProjectDeletionService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class ProjectController {
  log = $logger();
  alepha = $inject(Alepha);
  projectDeletion = $inject(ProjectDeletionService);
  projects = $repository(projects);
  members = $repository(members);
  /**
   * Relation-aware views of the two tables above, for the reads that used to
   * fetch one and then look up the other. Same tables, same rows — `include`
   * is the only thing they add.
   */
  projectsWith = $repository(relations, "projects");
  membersWith = $repository(relations, "members");
  usersWith = $repository(relations, "users");
  quests = $repository(quests);
  milestones = $repository(milestones);
  users = $repository(users);
  fileRepo = $repository(files);
  owned = $inject(OwnedResourceProvider);

  /**
   * Project-member gate: the project creator, or any user holding a
   * membership in it. Privileged identities bypass both.
   */
  protected ownsAsMember = () =>
    $owns({
      repository: () => this.projects,
      param: "id",
      owner: "createdBy",
      cast: Number,
      via: {
        repository: () => this.members,
        resource: "projectId",
        user: "userId",
      },
      message: "Not a member of this project",
    });

  /**
   * Project-owner gate: the creator only. Used for destructive and
   * configuration endpoints.
   */
  protected ownsAsOwner = () =>
    $owns({
      repository: () => this.projects,
      param: "id",
      owner: "createdBy",
      cast: Number,
      message: "Only the project owner can perform this action",
    });
  questMapper = $inject(QuestResourceMapper);
  limits = $inject(ProjectLimits);

  /**
   * Project icons (avatars). Image-only, 2 MB cap.
   *
   * Bucket value kept as `campaign-icons`, not renamed to `project-icons`:
   * it's a value already persisted on every existing `files` row (and in
   * production), not just an in-code identifier — same reasoning that keeps
   * `FOLIO_BLOB_BUCKET` at `"archive-blobs"` (see the note in
   * `FolioBlobService.ts`) and `FeedbackRateLimiter.ATTACHMENT_BUCKET` at
   * `"petition-attachments"`.
   */
  iconBucket = $storage({
    name: "campaign-icons",
    description: "Project icons",
    // Megabytes. This read `2 * 1024 * 1024` — two million megabytes.
    maxSize: 2,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });

  createProject = $action({
    use: [$secure({ permissions: ["project:create"] })],
    schema: {
      body: projects.insertSchema.pick({ title: true, icon: true }).extend({
        /**
         * Subset of module toggles to override at creation time. Anything
         * omitted falls back to `defaultProjectFeatures`. Lets the wizard
         * surface a "select modules" step without forcing the client to
         * resend the full feature payload.
         */
        features: projectFeaturesSchema.partial().optional(),
      }),
      response: projects.schema,
    },
    handler: async ({ body, user }) => {
      const maxProjectsPerUser = await this.limits.maxProjectsPerUser();
      const count = await this.projects.count({
        createdBy: { eq: user.id },
      });

      if (count >= maxProjectsPerUser) {
        throw new ForbiddenError(
          `You have reached the maximum number of projects allowed (${maxProjectsPerUser}).`,
        );
      }

      if (body.icon) {
        await this.assertIconBelongsToUser(body.icon, user);
      }

      const project = await this.projects.create({
        ...body,
        features: { ...defaultProjectFeatures, ...(body.features ?? {}) },
        createdBy: user.id,
      });

      await this.members.create({
        projectId: project.id,
        userId: user.id,
        owner: true,
      });

      return project;
    },
  });

  getMyProjects = $action({
    use: [
      $secure({ permissions: ["project:read"] }),
      // `noCache`, not a freshness window: the viewer creates, renames and
      // leaves projects from the pages that read this list, and `max-age`
      // let the browser answer those reads from its own cache without
      // asking — so the user's own write stayed invisible for the length of
      // the window. `no-cache` still permits storage and still lets the
      // ETag reply 304, so revalidation costs a header round trip, not a
      // body. Reserve `maxAge` for what the viewer cannot mutate.
      $etag({
        control: { private: true, noCache: true },
      }),
    ],
    description: "Get all projects for the authenticated user",
    schema: {
      query: pageQuerySchema,
      response: z.array(projects.schema),
    },
    handler: async ({ user, query }) => {
      // Membership is a many-to-many through `members`, so the two-step
      // fetch-ids-then-fetch-rows collapses into the relation itself.
      const me = await this.usersWith.findById(user.id, {
        include: {
          projects: {
            orderBy: { column: "updatedAt", direction: "desc" },
          },
        },
      });

      const all = me?.projects ?? [];
      const size = query.size ?? all.length;
      const page = query.page ?? 0;

      // Paging in memory is the honest translation here: the previous query
      // paged a filter whose id list had already been read in full, so the
      // work was never bounded by page size to begin with. The per-user
      // ownership limit keeps the list small.
      return all.slice(page * size, page * size + size);
    },
  });

  /**
   * One-shot Home page bootstrap: every project the user is a member of
   * (no cap — the per-user ownership limit keeps the list bounded), plus
   * the quota state needed to gate the "Create project" CTA.
   */
  getHomeOverview = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      response: z.object({
        projects: z.array(projects.schema),
        totalCount: z.integer(),
        ownedCount: z.integer(),
        maxProjects: z.integer(),
        canCreate: z.boolean(),
      }),
    },
    handler: async ({ user }) => {
      const maxProjectsPerUser = await this.limits.maxProjectsPerUser();

      const [me, ownedCount] = await Promise.all([
        this.usersWith.findById(user.id, {
          include: {
            projects: {
              orderBy: { column: "updatedAt", direction: "desc" },
            },
          },
        }),
        this.projects.count({ createdBy: { eq: user.id } }),
      ]);

      const result = me?.projects ?? [];

      return {
        projects: result,
        totalCount: result.length,
        ownedCount,
        maxProjects: maxProjectsPerUser,
        canCreate: ownedCount < maxProjectsPerUser,
      };
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  getProjectUsers = $action({
    use: [$secure({ permissions: ["project:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(users.schema),
    },
    handler: async ({ params }) => {
      // One statement: the membership hop through `members` is the
      // relation's business, not the handler's. No duplicates to guard
      // against — `members` is unique on (userId, projectId).
      const project = await this.projectsWith.findById(params.id, {
        include: { members: true },
      });

      return project?.members ?? [];
    },
  });

  updateProjectById = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: z.string().min(3).max(24).optional(),
        icon: z.uuid().nullable().optional(),
        features: projectFeaturesSchema.partial().optional(),
        milestoneDuration: z.string().nullable().optional(),
        preferredLanguage: z.string().max(8).nullable().optional(),
        // Blights retention window in days (Quest #90). `null` clears the
        // override → the purge cron falls back to the global 30-day default.
        retentionDays: z.integer().min(1).max(3_650).nullable().optional(),
      }),
      response: projects.schema,
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();

      if (body.title) {
        project.title = body.title.trim();
      }

      if ("icon" in body) {
        if (body.icon == null) {
          project.icon = undefined;
        } else {
          await this.assertIconBelongsToUser(body.icon, user);
          project.icon = body.icon;
        }
      }

      if ("milestoneDuration" in body) {
        project.milestoneDuration = body.milestoneDuration ?? undefined;
      }

      if ("retentionDays" in body) {
        project.retentionDays = body.retentionDays ?? undefined;
      }

      if ("preferredLanguage" in body) {
        // Empty string from the client (e.g. the "no preference"
        // sentinel) gets normalized to undefined so MCP can detect
        // "unset" cleanly with a falsy check.
        const lang = body.preferredLanguage?.trim();
        project.preferredLanguage = lang ? lang : undefined;
      }

      if (body.features) {
        project.features = {
          ...defaultProjectFeatures,
          ...project.features,
          ...body.features,
        };
      }

      await this.projects.save(project);
      return project;
    },
  });

  protected async assertIconBelongsToUser(
    iconId: string,
    user: UserAccountToken,
  ): Promise<void> {
    const found = await this.fileRepo.findOne({
      where: {
        id: { eq: iconId },
        creator: { eq: user.id },
        bucket: { eq: this.iconBucket.name },
      },
    });
    if (!found) {
      throw new BadRequestError("Invalid icon reference");
    }
  }

  getProjectById = $action({
    use: [$secure({ permissions: ["project:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: projects.schema.extend({
        member: members.schema.optional(),
        quests: z.array(questResourceSchema),
        /**
         * Total number of members in this project (including the viewer).
         */
        memberCount: z.integer(),
      }),
    },
    handler: async ({ params, user }) => {
      const project = this.owned.get<Project>();

      const member = await this.members.findOne({
        where: {
          projectId: { eq: params.id },
          userId: { eq: user.id },
        },
      });

      const projectQuests = await this.quests.findMany({
        where: {
          projectId: { eq: params.id },
          completedAt: { isNull: true },
          acceptedBy: { eq: user.id },
        },
      });

      const memberCount = await this.members.count({
        projectId: { eq: params.id },
      });

      return {
        ...project,
        quests: projectQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
        member,
        memberCount,
      };
    },
  });

  getProjectMembers = $action({
    use: [
      $secure({ permissions: ["project:read"] }),
      // Same reasoning as `getMyProjects`: members are invited and removed
      // from the settings page that reads this list, so a freshness window
      // hid the owner's own change from them.
      $etag({
        control: { private: true, noCache: true },
      }),
      this.ownsAsMember(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(
        members.schema.extend({
          user: users.schema,
        }),
      ),
    },
    handler: async ({ params }) => {
      const projectMembers = await this.membersWith.findMany({
        where: { projectId: { eq: params.id } },
        include: { user: true },
      });

      const membersWithUsers: Array<
        Member & {
          user: User;
        }
      > = [];

      for (const member of projectMembers) {
        if (!member.user) {
          // A membership whose account is gone. The row survives the user by
          // design, but the members list has nothing to show for it.
          this.log.warn(
            `User with id ${member.userId} not found for member ${member.id}`,
          );
          continue;
        }
        membersWithUsers.push({ ...member, user: member.user });
      }

      // Sort by owner first, then by creation date
      return membersWithUsers.sort((a, b) => {
        if (a.owner && !b.owner) return -1;
        if (!a.owner && b.owner) return 1;
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    },
  });

  deleteProjectById = $action({
    use: [$secure({ permissions: ["project:delete"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      // Shared with the admin shell's delete — see `ProjectDeletionService`
      // for why the cascade is not written out twice.
      await this.projectDeletion.deleteProject(params.id);

      return { ok: true };
    },
  });

  leaveProject = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const project = await this.projects.getOne({
        where: { id: { eq: params.id } },
      });

      // Owner cannot leave their own project — they must delete it or
      // transfer ownership (transfer not implemented yet).
      if (project.createdBy === user.id) {
        throw new ForbiddenError(
          "The owner cannot leave their own project. Delete it instead.",
        );
      }

      const member = await this.members.findOne({
        where: {
          userId: { eq: user.id },
          projectId: { eq: params.id },
        },
      });

      if (!member) {
        // Idempotent: leaving a project you're not a member of is a no-op.
        return { ok: true };
      }

      // Release any in-flight quests the user accepted but did not complete,
      // so other members can pick them up. Completed quests stay attributed.
      await this.quests.updateMany(
        {
          projectId: { eq: params.id },
          acceptedBy: { eq: user.id },
          completedAt: { isNull: true },
        },
        {
          acceptedAt: null,
          acceptedBy: null,
        },
      );

      await this.members.deleteById(member.id);

      return { ok: true };
    },
  });

  getAreas = $action({
    use: [$secure({ permissions: ["project:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(
        z.object({
          name: z.string(),
          questCount: z.integer(),
          firstQuestAt: z.string().optional(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      const project = this.owned.get<Project>();

      const projectQuests = await this.quests.findMany({
        where: { projectId: { eq: params.id } },
      });

      // Aggregate per area: union of project.areas + areas found on quests so
      // empty areas (no quests) still appear, and orphan areas (quest with a
      // area the project forgot) aren't lost.
      const stats = new Map<
        string,
        { questCount: number; firstQuestAt?: string }
      >();
      for (const name of project.areas ?? []) {
        stats.set(name, { questCount: 0 });
      }
      for (const quest of projectQuests) {
        const prev = stats.get(quest.area) ?? { questCount: 0 };
        const ts =
          typeof quest.createdAt === "string"
            ? quest.createdAt
            : new Date(quest.createdAt as never).toISOString();
        const firstQuestAt =
          prev.firstQuestAt && prev.firstQuestAt < ts ? prev.firstQuestAt : ts;
        stats.set(quest.area, {
          questCount: prev.questCount + 1,
          firstQuestAt,
        });
      }

      return [...stats.entries()]
        .map(([name, s]) => ({
          name,
          questCount: s.questCount,
          firstQuestAt: s.firstQuestAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  renameArea = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        oldAreaName: z.string(),
        newAreaName: z.string().min(1),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();

      // Update all quests with the old area name to the new one
      const questsToUpdate = await this.quests.findMany({
        where: {
          projectId: { eq: params.id },
          area: { eq: body.oldAreaName },
        },
      });

      // Update each quest's area field
      for (const quest of questsToUpdate) {
        await this.quests.updateById(quest.id, {
          area: body.newAreaName,
        });
      }

      // Update the project's areas array
      const updatedAreas = project.areas.map((pkg) =>
        pkg === body.oldAreaName ? body.newAreaName : pkg,
      );

      await this.projects.updateById(params.id, {
        areas: updatedAreas,
      });

      return { ok: true };
    },
  });

  // ── Kanban column CRUD ──────────────────────────────────────────────

  addKanbanColumn = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        name: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      const name = body.name.trim();
      if (!name) {
        throw new BadRequestError("Column name must not be empty.");
      }
      if (current.length >= 5) {
        throw new BadRequestError(
          "A project can have at most 5 kanban columns.",
        );
      }
      if (current.includes(name)) {
        throw new BadRequestError("A column with this name already exists.");
      }
      const updated = [...current, name];
      await this.projects.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  renameKanbanColumn = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        oldName: z.string(),
        newName: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      const newName = body.newName.trim();
      if (!current.includes(body.oldName)) {
        throw new BadRequestError("Column not found.");
      }
      if (newName === body.oldName) return current;
      if (current.includes(newName)) {
        throw new BadRequestError("A column with this name already exists.");
      }

      // Cascade-rename onto every quest that lives in that column.
      const affected = await this.quests.findMany({
        where: {
          projectId: { eq: params.id },
          kanbanColumn: { eq: body.oldName },
        },
      });
      for (const quest of affected) {
        await this.quests.updateById(quest.id, { kanbanColumn: newName });
      }

      const updated = current.map((c) => (c === body.oldName ? newName : c));
      await this.projects.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  deleteKanbanColumn = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ name: z.string() }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      if (!current.includes(body.name)) {
        throw new BadRequestError("Column not found.");
      }
      if (current.length <= 1) {
        throw new BadRequestError("A project must keep at least one column.");
      }

      // Refuse if any quest still lives in this column.
      const occupants = await this.quests.count({
        projectId: { eq: params.id },
        kanbanColumn: { eq: body.name },
      });
      if (occupants > 0) {
        throw new BadRequestError(
          "Move or complete the quests in this column before deleting it.",
        );
      }

      const updated = current.filter((c) => c !== body.name);
      await this.projects.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  reorderKanbanColumns = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        columns: z.array(z.string()).min(1).max(5),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      // Must reorder the exact same set — additions/removals go through the
      // dedicated endpoints so concurrent edits can't drop a column silently.
      if (
        body.columns.length !== current.length ||
        new Set(body.columns).size !== body.columns.length ||
        body.columns.some((c) => !current.includes(c))
      ) {
        throw new BadRequestError(
          "Reordered list must contain the same columns.",
        );
      }
      await this.projects.updateById(params.id, {
        kanbanColumns: body.columns,
      });
      return body.columns;
    },
  });
}
