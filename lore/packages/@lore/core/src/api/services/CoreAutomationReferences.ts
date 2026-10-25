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
      read: async ({ projectId, offset, limit, search, ids }) => {
        const project = await this.security.projects.getById(projectId);
        const narrowed = !!search || !!ids;
        // A search reads the whole roster's ids, bounded, and filters on the
        // user rows; a plain page pages the roster itself.
        const members = await this.security.members.findMany({
          where: {
            organizationId: project.organizationId!,
            ...(ids ? { userId: { inArray: ids } } : {}),
          },
          columns: ["userId"],
          orderBy: "id",
          ...(narrowed ? { limit: 1_000 } : { offset, limit: limit + 1 }),
        });
        const candidates = members
          .slice(0, narrowed ? members.length : limit)
          .map((member) => member.userId);
        const users = candidates.length
          ? await this.users.findMany({
              where: {
                id: { inArray: candidates },
                enabled: true,
                ...(search
                  ? {
                      or: [
                        { username: { contains: search } },
                        { firstName: { contains: search } },
                        { lastName: { contains: search } },
                        { email: { contains: search } },
                      ],
                    }
                  : {}),
              },
              columns: ["id", "username", "firstName", "lastName", "email"],
              ...(narrowed
                ? { orderBy: "username", offset, limit: limit + 1 }
                : {}),
            })
          : [];
        const byId = new Map(users.map((user) => [user.id, user]));
        const order = narrowed ? users.map((user) => user.id) : candidates;
        return {
          items: order.slice(0, limit).flatMap((id) => {
            const user = byId.get(id);
            return user
              ? [
                  {
                    value: id,
                    label: (
                      [user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ") ||
                      user.username ||
                      user.email ||
                      id
                    ).slice(0, 255),
                  },
                ]
              : [];
          }),
          hasMore: narrowed ? users.length > limit : members.length > limit,
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
