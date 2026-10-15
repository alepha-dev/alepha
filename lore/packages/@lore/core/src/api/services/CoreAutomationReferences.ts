import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { users } from "../entities/users.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import { ProjectPermissions } from "../security/ProjectPermissions.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationReferences } from "./AutomationReferences.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

export class CoreAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly users = $repository(users);
  protected readonly permissions = $inject(ProjectPermissions);
  constructor() {
    this.references.register("member", async (projectId, value) => {
      if (typeof value !== "string") return "Member must be a stable user ID";
      return (await this.security.isMemberById(projectId, value))
        ? undefined
        : "Member is no longer in this project";
    });
    this.references.register("channel", async (projectId, value) =>
      (await this.channels.all(projectId)).some(
        (channel) => channel.key === value && channel.available,
      )
        ? undefined
        : "Channel transport or destination is not configured",
    );
  }
  public async recipientReason(
    projectId: number,
    recipient: string,
    source: AutomationDescriptor,
  ): Promise<string | undefined> {
    const project = await this.security.projects.getById(projectId);
    const member = await this.security.members.findOne({
      where: { organizationId: project.organizationId!, userId: recipient },
    });
    if (!member) return "Recipient is no longer a project member";
    const account = await this.users.findById(recipient);
    if (!account?.enabled) return "Recipient account is unavailable";
    const effective = await this.permissions.of(
      projectId,
      { id: account.id, roles: account.roles, ownership: true },
      member,
    );
    const missing = source.permissions.find(
      (permission) => !effective.permissions.includes(permission),
    );
    return missing ? `Recipient lacks source permission ${missing}` : undefined;
  }
}
