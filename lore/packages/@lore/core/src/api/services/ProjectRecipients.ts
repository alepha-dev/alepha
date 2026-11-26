import { $inject } from "alepha";
import type { OrganizationMember } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { users } from "../entities/users.ts";
import { ProjectPermissions } from "../security/ProjectPermissions.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * Who may receive what in a project, checked at delivery (#Q3890): still a
 * member, account enabled, and holding the event's read permission. The
 * logic the automation engine's `recipientReason` had, under a neutral name.
 */
export class ProjectRecipients {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly permissions = $inject(ProjectPermissions);
  protected readonly users = $repository(users);

  /**
   * Why `userId` may not receive an event needing `permission` here, or
   * undefined when they may. A refusal is not an error: the member simply
   * receives nothing.
   */
  public async refusal(
    projectId: number,
    userId: string,
    permission: string,
  ): Promise<string | undefined> {
    const project = await this.security.projects.findById(projectId);
    if (!project?.organizationId) return "The project is gone";
    const member = await this.security.members.findOne({
      where: { organizationId: project.organizationId, userId },
    });
    if (!member) return "No longer a project member";
    const account = await this.users.findById(userId);
    if (!account?.enabled) return "Account unavailable";
    const held = await this.held(
      projectId,
      { id: account.id, roles: account.roles, ownership: true },
      member,
    );
    return held.includes(permission) ? undefined : `Lacks ${permission}`;
  }

  /**
   * Whether `userId` is a member of the project now (#Q4055): what a
   * subscription's `notMembers` reads of an event's actor.
   */
  public async isMember(projectId: number, userId: string): Promise<boolean> {
    const organizationId = await this.security.organizationIdOf(projectId);
    const member = await this.security.members.findOne({
      where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
    });
    return !!member;
  }

  /**
   * The caller's permissions in a project, or none when they hold no
   * membership.
   */
  public async of(
    projectId: number,
    user: UserAccountToken,
  ): Promise<string[]> {
    const organizationId = await this.security.organizationIdOf(projectId);
    const member = await this.security.members.findOne({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: user.id },
      },
    });
    if (!member && !this.security.bypassesMembership(user)) return [];
    return this.held(projectId, user, member ?? undefined);
  }

  protected async held(
    projectId: number,
    user: UserAccountToken,
    member: OrganizationMember | undefined,
  ): Promise<string[]> {
    return (await this.permissions.of(projectId, user, member)).permissions;
  }
}
