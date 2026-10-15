import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { ProjectPermissions } from "../security/ProjectPermissions.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * Shared normal-authoring gate. Execution additionally reconstructs the live
 * author's key ceiling before every effect; it never uses the job's token.
 */
export class AutomationAccess {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly permissions = $inject(ProjectPermissions);

  public async assert(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
  ): Promise<void> {
    await this.authorize(projectId, user, permission);
  }

  public async authorize(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
  ) {
    const { project, member } = await this.membership(projectId, user);
    const allowed = await this.permissions.of(
      projectId,
      { ...user, ownership: true },
      member,
    );
    if (!allowed.permissions.includes(permission))
      throw new ForbiddenError(`Missing ${permission}`);
    await this.security.assertCapability(projectId, "work", {
      option: "automations",
      action: "use automations",
    });
    return {
      project,
      member,
      permissions: allowed.permissions,
      capabilities: await this.security.capabilitiesOf(projectId),
    };
  }

  public async assertOwner(
    projectId: number,
    user: UserAccountToken,
  ): Promise<void> {
    const { member } = await this.membership(projectId, user);
    if (member.rank !== "owner")
      throw new ForbiddenError(
        "Automation diagnostics require the project owner",
      );
  }

  public async assertMutation(
    rule: Automation,
    user: UserAccountToken,
    action: "edit" | "enable" | "disable" | "delete",
  ): Promise<void> {
    if (rule.authorUserId === user.id) {
      await this.assert(rule.projectId, user, "automation:write");
      return;
    }
    if (action !== "disable" && action !== "delete")
      throw new ForbiddenError(
        "Only the immutable author can edit or enable this automation",
      );
    await this.assert(rule.projectId, user, "automation:manage");
  }

  protected async membership(projectId: number, user: UserAccountToken) {
    const project = await this.security.projects.getById(projectId);
    const member = await this.security.members.findOne({
      where: { organizationId: project.organizationId!, userId: user.id },
    });
    if (!member)
      throw new ForbiddenError("Not a current member of this project");
    return { project, member };
  }
}
