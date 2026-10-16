import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { users } from "../entities/users.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import { AutomationProjectPermissions } from "../security/AutomationProjectPermissions.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";
import { AutomationReferences } from "./AutomationReferences.ts";

export class CoreAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly users = $repository(users);
  protected readonly permissions = $inject(AutomationProjectPermissions);
  constructor() {
    this.references.registerOptions("member", {
      permission: "member:read",
      read: async ({ projectId, offset, limit }) => {
        const project = await this.security.projects.getById(projectId);
        const members = await this.security.members.findMany({
          where: { organizationId: project.organizationId! },
          orderBy: "id",
          offset,
          limit: limit + 1,
        });
        const ids = members.slice(0, limit).map((member) => member.userId);
        const users = ids.length
          ? await this.users.findMany({
              where: { id: { inArray: ids }, enabled: true },
              columns: ["id", "username", "firstName", "lastName", "email"],
            })
          : [];
        const byId = new Map(users.map((user) => [user.id, user]));
        return {
          items: ids.flatMap((id) => {
            const user = byId.get(id);
            return user
              ? [
                  {
                    value: id,
                    label: (
                      user.username ||
                      [user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ") ||
                      user.email ||
                      id
                    ).slice(0, 255),
                  },
                ]
              : [];
          }),
          hasMore: members.length > limit,
        };
      },
    });
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
