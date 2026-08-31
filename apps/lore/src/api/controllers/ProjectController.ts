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
  ConflictError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";

// The helper the UI labels a user with, so an actor reads identically in an
// activity feed and on the quest page. Precedent for reaching across:
// `FolioBlobService` imports `folioAssetPath` from the same tree. Pure
// function, no imports of its own.
import { displayName } from "../../web/app/services/displayName.ts";
import { type Member, members } from "../entities/members.ts";
import {
  defaultProjectFeatures,
  type Project,
  projectFeaturesSchema,
  projects,
} from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type { User } from "../entities/users.ts";
import { relations } from "../relations.ts";
import { kanbanColumnConfigSchema } from "../schemas/kanbanColumnSchema.ts";
import { paletteColorSchema } from "../schemas/paletteColorSchema.ts";
import { projectActivityResultSchema } from "../schemas/projectActivitySchema.ts";
import { projectRepositoryUrlSchema } from "../schemas/projectRepositoryUrlSchema.ts";
import {
  projectOverviewResourceSchema,
  projectResourceSchema,
} from "../schemas/projectResourceSchema.ts";
import { projectTitleSchema } from "../schemas/projectTitleSchema.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { roadmapVisibilitySchema } from "../schemas/roadmapVisibilitySchema.ts";
import { AreaService } from "../services/AreaService.ts";
import { OpenQuestScope } from "../services/OpenQuestScope.ts";
import { ProjectActivityService } from "../services/ProjectActivityService.ts";
import { ProjectDeletionService } from "../services/ProjectDeletionService.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ProjectResourceMapper } from "../services/ProjectResourceMapper.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { ProjectSlugService } from "../services/ProjectSlugService.ts";
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
  releases = $repository(releases);
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
  projectMapper = $inject(ProjectResourceMapper);
  limits = $inject(ProjectLimits);
  slugs = $inject(ProjectSlugService);
  projectSecurity = $inject(ProjectSecurityService);
  areaService = $inject(AreaService);
  activityService = $inject(ProjectActivityService);
  openQuests = $inject(OpenQuestScope);

  /**
   * Reserve-and-collision gate for a project slug.
   *
   * Lives here rather than on {@link ProjectSlugService} because it needs the
   * `projects` repository, and that service stays dependency-free so the
   * browser can construct it for the settings page's rename check.
   *
   * `exceptProjectId` lets a rename re-assert its own current slug without
   * colliding with itself.
   *
   * ⚠️ `findOne` filters soft-deleted rows out, so a deleted project's slug is
   * invisible here while the UNIQUE index still enforces it. That would turn a
   * reuse into a constraint violation (a 500) instead of this clean 409 — which
   * is why {@link ProjectDeletionService.deleteProject} clears the slug rather
   * than leaving it on the tombstone.
   */
  protected async assertSlugAvailable(
    slug: string,
    exceptProjectId?: number,
  ): Promise<void> {
    if (this.slugs.isReserved(slug)) {
      throw new BadRequestError(`The name "${slug}" is reserved`);
    }

    const existing = await this.projects.findOne({
      where: { slug: { eq: slug } },
    });

    if (existing && existing.id !== exceptProjectId) {
      throw new ConflictError("That name is already taken");
    }
  }

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
         * Tighter than the entity's own `title`, and deliberately only on the
         * way in: the title derives the URL slug, so it is constrained to what
         * can produce one. The entity column stays permissive because its
         * schema also decodes rows on READ.
         */
        title: projectTitleSchema,
        /**
         * Subset of module toggles to override at creation time. Anything
         * omitted falls back to `defaultProjectFeatures`. Lets the wizard
         * surface a "select modules" step without forcing the client to
         * resend the full feature payload.
         */
        features: projectFeaturesSchema.partial().optional(),
      }),
      response: projectResourceSchema,
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

      const slug = this.slugs.slugify(body.title);
      if (slug) {
        await this.assertSlugAvailable(slug);
      }

      const project = await this.projects.create({
        ...body,
        slug: slug || undefined,
        features: { ...defaultProjectFeatures, ...body.features },
        createdBy: user.id,
      });

      // A title that transliterates to nothing (e.g. "日本語") has no slug
      // until the row has an id, so this is the one path that writes the slug
      // twice. It cannot collide: `isReserved` keeps the `project-<n>`
      // namespace out of user hands.
      if (!project.slug) {
        project.slug = this.slugs.fallbackSlug(project.id);
        await this.projects.save(project);
      }

      await this.members.create({
        projectId: project.id,
        userId: user.id,
        owner: true,
      });

      return this.projectMapper.toResource(project);
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
      response: z.array(projectResourceSchema),
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
      return all
        .slice(page * size, page * size + size)
        .map((it) => this.projectMapper.toResource(it));
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
        projects: z.array(projectOverviewResourceSchema),
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

      // `areas` (the `projects.areas` column) is `@deprecated` and frozen —
      // the Home page's "N areas" stat is re-sourced from the `areas` table
      // here instead, one batched query rather than one per card.
      const projectIds = result.map((it) => it.id);
      const [areaCounts, openQuestCounts] = await Promise.all([
        this.areaService.countByProjectIds(projectIds),
        // The dashboard rail's per-project number. Counted through the same
        // scope as the sidebar badge and the Active Quests tile: all three are
        // visible together, and a disagreement between them is one of them
        // lying rather than a rounding difference.
        this.openQuests.countByProject(projectIds),
      ]);

      return {
        projects: result.map((it) => ({
          ...this.projectMapper.toResource(it),
          areaCount: areaCounts.get(it.id) ?? 0,
          openQuestCount: openQuestCounts.get(it.id) ?? 0,
        })),
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

  /**
   * Everything that moved in a project since a timestamp.
   *
   * Backs MCP's `project_activity`, which exists so an agent picking up a
   * session can see what other people did while it was away instead of
   * polling `quest_get` per quest.
   *
   * Member-gated like every other project read. Names are resolved here
   * rather than in the service, so the same display name shows in a feed
   * and on the quest page.
   */
  getProjectActivity = $action({
    use: [$secure({ permissions: ["project:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      query: z.object({
        since: z.datetime(),
        limit: z.integer().min(1).max(200).optional(),
        /**
         * Include events the caller performed. Off by default: the question
         * this answers is what OTHERS did, and a busy session's own writes
         * would drown that out.
         */
        includeOwn: z.boolean().optional(),
      }),
      response: projectActivityResultSchema,
    },
    handler: async ({ params, query, user }) => {
      const result = await this.activityService.collect({
        projectId: params.id,
        since: query.since,
        limit: query.limit ?? 100,
        excludeUserId: query.includeOwn ? undefined : user.id,
      });

      // One lookup for the page, and only when something needs a name.
      const actorIds = new Set(
        result.events.map((event) => event.actorId).filter(Boolean),
      );
      const people = actorIds.size
        ? await this.getProjectUsers({ params: { id: params.id } })
        : [];

      return {
        ...result,
        events: result.events.map((event) => ({
          ...event,
          actor: event.actorId
            ? displayName(
                people.find((person) => person.id === event.actorId),
                event.actorId,
              )
            : undefined,
        })),
        // Never moves backwards over events the caller has not seen: with
        // nothing to report, the window's own start is the honest cursor.
        until: result.events.at(-1)?.at ?? result.since,
      };
    },
  });

  updateProjectById = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: projectTitleSchema.optional(),
        icon: z.uuid().nullable().optional(),
        features: projectFeaturesSchema.partial().optional(),
        preferredLanguage: z.string().max(8).nullable().optional(),
        // The repository a quest's commit shas link into. `null` clears it,
        // and the shas go back to being plain text.
        repositoryUrl: projectRepositoryUrlSchema.nullable().optional(),
        // Blights retention window in days (Quest #90). `null` clears the
        // override → the purge cron falls back to the global 30-day default.
        retentionDays: z.integer().min(1).max(3_650).nullable().optional(),
        // Which surface bare `/:projectSlug` lands on. `null` clears the
        // override → the index route falls back to the quest table.
        defaultSurface: z.enum(["list", "kanban"]).nullable().optional(),
        // Who may read `/:projectSlug/roadmap`. `null` clears the override →
        // `ProjectSecurityService.roadmapVisibilityOf` reads it as `off`.
        roadmapVisibility: roadmapVisibilitySchema.nullable().optional(),
        // Colour token per quest tag. Sent whole, not merged: the settings
        // picker holds the full map, and a partial merge gives no way to
        // clear one tag's colour without inventing a "none" token.
        tagColors: z.record(z.text(), paletteColorSchema).nullable().optional(),
        // Per-column board settings, keyed by column name. Sent whole, not
        // merged: removing a key is how a column's setting is cleared, and
        // a server-side merge has no way to express that.
        kanbanColumnConfig: kanbanColumnConfigSchema.nullable().optional(),
      }),
      response: projectResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();

      if (body.title) {
        // `projectTitleSchema` trims, so no `.trim()` here.
        project.title = body.title;

        // Renaming moves the project's URL. The old slug is freed rather than
        // kept as a redirect — deliberate, and the reason the settings page
        // gates the rename behind a confirm dialog naming both URLs.
        const slug = this.slugs.slugify(body.title);
        // An empty slug means the new title transliterates to nothing; keep
        // the id fallback rather than leaving the project unreachable.
        const nextSlug = slug || this.slugs.fallbackSlug(project.id);
        if (nextSlug !== project.slug) {
          await this.assertSlugAvailable(nextSlug, project.id);
          project.slug = nextSlug;
        }
      }

      if ("icon" in body) {
        if (body.icon == null) {
          project.icon = undefined;
        } else {
          await this.assertIconBelongsToUser(body.icon, user);
          project.icon = body.icon;
        }
      }

      if ("retentionDays" in body) {
        project.retentionDays = body.retentionDays ?? undefined;
      }

      if ("defaultSurface" in body) {
        project.defaultSurface = body.defaultSurface ?? undefined;
      }

      if ("roadmapVisibility" in body) {
        project.roadmapVisibility = body.roadmapVisibility ?? undefined;
      }

      if ("tagColors" in body) {
        project.tagColors = body.tagColors ?? undefined;
      }

      if ("kanbanColumnConfig" in body) {
        project.kanbanColumnConfig = body.kanbanColumnConfig ?? undefined;
      }

      if ("preferredLanguage" in body) {
        // Empty string from the client (e.g. the "no preference"
        // sentinel) gets normalized to undefined so MCP can detect
        // "unset" cleanly with a falsy check.
        const lang = body.preferredLanguage?.trim();
        project.preferredLanguage = lang ? lang : undefined;
      }

      if ("repositoryUrl" in body) {
        // Same normalisation as `preferredLanguage`: an empty string from a
        // cleared form field means "unset", not "the empty URL".
        const url = body.repositoryUrl?.trim();
        project.repositoryUrl = url ? url : undefined;
      }

      if (body.features) {
        project.features = {
          ...defaultProjectFeatures,
          ...project.features,
          ...body.features,
        };
      }

      await this.projects.save(project);
      return this.projectMapper.toResource(project);
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
      response: projectResourceSchema.extend({
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
        ...this.projectMapper.toResource(project),
        quests: projectQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
        member,
        memberCount,
      };
    },
  });

  /**
   * Resolve a project by its URL slug.
   *
   * The `project` route layout calls this once per navigation and seeds
   * `currentProjectAtom` with the result; every other project endpoint still
   * takes an integer `projectId`, read off that atom. That is what keeps slug
   * routing out of the rest of the API surface.
   *
   * `$owns` cannot gate this one — it looks a resource up by primary key from
   * a path param, and this param is not the key. The membership check is
   * therefore explicit, through the same `ProjectSecurityService.assertMember`
   * every other project-scoped read uses. A slug is guessable in a way an id
   * is not, so this gate is the only thing standing between a typed URL and
   * another tenant's project.
   */
  getProjectBySlug = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/by-slug/:slug",
    schema: {
      params: z.object({
        slug: z.string(),
      }),
      response: projectResourceSchema.extend({
        member: members.schema.optional(),
        quests: z.array(questResourceSchema),
        /**
         * Total number of members in this project (including the viewer).
         */
        memberCount: z.integer(),
      }),
    },
    handler: async ({ params, user }) => {
      // Soft-deleted rows are filtered out by the repository, so a deleted
      // project does not resolve by its old slug.
      const found = await this.projects.findOne({
        where: { slug: { eq: params.slug } },
      });

      if (!found) {
        throw new NotFoundError("Project not found");
      }

      const { project } = await this.projectSecurity.assertMember(
        found.id,
        user,
      );

      const member = await this.members.findOne({
        where: {
          projectId: { eq: project.id },
          userId: { eq: user.id },
        },
      });

      const projectQuests = await this.quests.findMany({
        where: {
          projectId: { eq: project.id },
          completedAt: { isNull: true },
          acceptedBy: { eq: user.id },
        },
      });

      const memberCount = await this.members.count({
        projectId: { eq: project.id },
      });

      return {
        ...this.projectMapper.toResource(project),
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
      // The settings map is keyed by name, so a rename has to carry the
      // entry across or the column silently loses its status and its WIP
      // limit — which for a `completed` column would quietly turn it back
      // into an in-progress lane.
      const config = { ...project.kanbanColumnConfig };
      if (config[body.oldName]) {
        config[newName] = config[body.oldName];
        delete config[body.oldName];
      }
      await this.projects.updateById(params.id, {
        kanbanColumns: updated,
        kanbanColumnConfig: Object.keys(config).length ? config : undefined,
      });
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
      // Drop the deleted column's settings too. Leaving them would be inert
      // today, but re-creating a column with the same name would silently
      // resurrect a status and a WIP limit nobody asked for.
      const remainingConfig = { ...project.kanbanColumnConfig };
      delete remainingConfig[body.name];
      await this.projects.updateById(params.id, {
        kanbanColumns: updated,
        kanbanColumnConfig: Object.keys(remainingConfig).length
          ? remainingConfig
          : undefined,
      });
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
