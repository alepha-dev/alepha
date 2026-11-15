import { $inject, Alepha, z } from "alepha";
import {
  MemberService,
  organizationMembers,
  OrganizationPolicyProvider,
} from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import { $secure } from "alepha/security";
import {
  $action,
  ForbiddenError,
  HttpError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { openProjectCardSchema } from "../schemas/openProjectCardSchema.ts";
import { projectJoinResultSchema } from "../schemas/projectJoinResultSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectExclusions } from "../services/ProjectExclusions.ts";
import { ProjectJoinPolicy } from "../services/ProjectJoinPolicy.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * Joining an open project by yourself (#Q3646, epic #E151).
 *
 * - {@link previewOpenProject} needs no session: the card of an open
 *   project, or the same 404 for an invite-only and an unknown one, so a
 *   stranger cannot tell the two apart.
 * - {@link joinProject} needs a session and an explicit call: visiting a link
 *   never enrolls anyone. It lands the caller on the `viewer` rank, checking
 *   the allowlist, the member cap, the exclusion of someone an admin removed,
 *   and a per-user and per-IP rate limit.
 * - {@link listProjectExclusions} and {@link liftProjectExclusion} are the
 *   admin's half: who may not rejoin, and letting them.
 */
export class ProjectJoinController {
  protected readonly alepha = $inject(Alepha);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);
  protected readonly memberService = $inject(MemberService);
  protected readonly policy = $inject(OrganizationPolicyProvider);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly joinPolicy = $inject(ProjectJoinPolicy);
  protected readonly exclusions = $inject(ProjectExclusions);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Joins per account: a person joins a handful of projects, never dozens
   * an hour.
   */
  protected readonly joinsPerUser = $rateLimit({
    name: "lore:project-join:user",
    limit: 20,
    window: [1, "hour"],
  });

  /**
   * Joins per address, so a farm of fresh accounts behind one IP is capped
   * too.
   */
  protected readonly joinsPerIp = $rateLimit({
    name: "lore:project-join:ip",
    limit: 60,
    window: [1, "hour"],
  });

  previewOpenProject = $action({
    method: "GET",
    path: "/projects/open/:slug",
    schema: {
      params: z.object({ slug: z.text() }),
      response: openProjectCardSchema,
    },
    handler: async ({ params }) => {
      const project = await this.openProject({ slug: { eq: params.slug } });
      return {
        id: project.id,
        title: project.title,
        slug: project.slug ?? params.slug,
        ...(project.icon ? { icon: project.icon } : {}),
      };
    },
  });

  joinProject = $action({
    method: "POST",
    path: "/projects/:id/join",
    use: [$secure()],
    schema: {
      params: z.object({ id: z.integer() }),
      response: projectJoinResultSchema,
    },
    handler: async ({ params, user }) => {
      const project = await this.openProject({ id: { eq: params.id } });
      const organizationId = project.organizationId!;
      const slug = project.slug ?? String(project.id);

      // Already a member: nothing to do, and their rank is left alone.
      const existing = await this.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: user.id },
        },
      });
      if (existing) {
        return { joined: false, rank: existing.rank ?? "member", slug };
      }

      if (await this.exclusions.isExcluded(project.id, user.id)) {
        throw new ForbiddenError(
          "An admin removed you from this project, so you cannot rejoin it by yourself. Ask an admin to let you back in.",
        );
      }

      await this.assertJoinAllowed(user.id);
      await this.joinPolicy.assertViewerFits(organizationId);
      await this.policy.assertRoom(organizationId);

      await this.memberService.add(
        organizationId,
        user.id,
        ProjectJoinPolicy.VIEWER_KEY,
        user,
      );
      // A removal racing this join: if an admin's exclusion landed in
      // between, take the membership back (see `ProjectExclusions`).
      if (await this.exclusions.isExcluded(project.id, user.id)) {
        await this.exclusions.exclude(project.id, user.id, user.id);
        throw new ForbiddenError(
          "An admin removed you from this project, so you cannot rejoin it by yourself.",
        );
      }

      await this.audits.member.logSuccess("self_join", {
        ...this.audits.actor(user),
        ...this.audits.scope(project.id),
        resourceType: "project",
        resourceId: String(project.id),
        description: project.title,
      });

      return { joined: true, rank: ProjectJoinPolicy.VIEWER_KEY, slug };
    },
  });

  listProjectExclusions = $action({
    method: "GET",
    path: "/projects/:id/exclusions",
    use: [$ownsProject({ param: "id", requires: "member:manage" })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.array(
        z.object({
          userId: z.uuid(),
          excludedBy: z.uuid(),
          createdAt: z.datetime(),
        }),
      ),
    },
    handler: async ({ params }) =>
      (await this.exclusions.list(params.id)).map((row) => ({
        userId: row.userId,
        excludedBy: row.excludedBy,
        createdAt: row.createdAt,
      })),
  });

  liftProjectExclusion = $action({
    method: "DELETE",
    path: "/projects/:id/exclusions/:userId",
    use: [$ownsProject({ param: "id", requires: "member:manage" })],
    schema: {
      params: z.object({ id: z.integer(), userId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      if (await this.exclusions.lift(params.id, params.userId)) {
        await this.audits.member.logSuccess("lift", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.id),
          resourceType: "project",
          resourceId: String(params.id),
          metadata: { userId: params.userId },
        });
      }
      return { ok: true };
    },
  });

  /**
   * The project if it is open, or the one 404 an invite-only, archived and
   * unknown project all give.
   */
  protected async openProject(
    where: Record<string, unknown>,
  ): Promise<Project> {
    const project = await this.projects.findOne({ where: where as never });
    if (
      !project ||
      project.archivedAt ||
      !project.organizationId ||
      this.security.joinPolicyOf(project) !== "open"
    ) {
      throw new NotFoundError("Project not found");
    }
    return project;
  }

  protected async assertJoinAllowed(userId: string): Promise<void> {
    const ip = this.alepha.store.get("alepha.http.request")?.ip;
    const results = [
      await this.joinsPerUser.consume(userId),
      ...(ip ? [await this.joinsPerIp.consume(ip)] : []),
    ];
    if (results.some((result) => !result.allowed)) {
      throw new HttpError(
        { status: 429 },
        { message: "Too many projects joined. Try again later." },
      );
    }
  }
}
