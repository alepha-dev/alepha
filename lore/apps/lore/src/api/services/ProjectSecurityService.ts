import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";
import { type Member, members } from "../entities/members.ts";
import { type Project, projects } from "../entities/projects.ts";

/**
 * Project access gates.
 *
 * Deliberately separate from `AppSecurityProvider`, which declares the
 * `$realm`. `$realm` registers services into the container from inside a
 * class-field initializer, so anything that both declares it *and* is widely
 * injected becomes a hub in the dependency graph — `LoreFileAccessProvider`
 * needs a membership check, and injecting the realm-declaring class from
 * there closed a loop back into its own construction.
 *
 * Authorization is domain logic; realm configuration is infrastructure. They
 * do not belong in one class.
 */
export class ProjectSecurityService {
  projects = $repository(projects);
  members = $repository(members);

  /**
   * Membership gate. Requires the caller to be the project owner or a
   * member (membership row exists). Used for every project-scoped read
   * AND write — Lore projects are always private; there is no
   * non-member visibility path.
   *
   * `user.ownership === false` is a privileged identity (admin without
   * narrow ownership scope) and bypasses the membership check.
   */
  async assertMember(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });

    if (project.createdBy === user.id || !user.ownership) {
      return { project };
    }

    const member = await this.members.findOne({
      where: {
        projectId: { eq: projectId },
        userId: { eq: user.id },
      },
    });

    if (!member) {
      throw new ForbiddenError("Not a member of this project");
    }
    return { project, member };
  }

  /**
   * Non-throwing **literal** membership check — `true` when the caller created
   * the project or holds a membership in it.
   *
   * Unlike {@link assertMember}, this deliberately does NOT honor the
   * `user.ownership` privileged-identity bypass: that bypass governs *access*
   * (a privileged admin may read member-gated data), whereas this answers
   * "does the caller *belong* to this project?". Used to branch on membership
   * (e.g. exempting members from the feedback rate limit), not to gate access.
   */
  async isMember(projectId: number, user: UserAccountToken): Promise<boolean> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) {
      return false;
    }
    if (project.createdBy === user.id) {
      return true;
    }
    const member = await this.members.findOne({
      where: {
        projectId: { eq: projectId },
        userId: { eq: user.id },
      },
    });
    return !!member;
  }

  /**
   * Owner-only gate. Requires the caller to be the project creator (or a
   * privileged identity with `user.ownership === false`). Use for
   * destructive or project-configuration endpoints: delete project,
   * change features, manage kanban columns, manage milestones, import quests,
   * send invitations.
   */
  async assertOwner(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });

    if (project.createdBy !== user.id && user.ownership) {
      throw new ForbiddenError(
        "Only the project owner can perform this action",
      );
    }

    return { project };
  }
}

export interface ProjectGuard {
  project: Project;
  member?: Member;
}
