import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { LoreAudits } from "../services/LoreAudits.ts";

export class OrganizationHooks {
  protected readonly projects = $repository(projects);
  protected readonly quests = $repository(quests);
  protected readonly audits = $inject(LoreAudits);

  protected readonly onMemberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId, actor, leave }) => {
      const project = await this.projects.getOne({
        where: { organizationId: { eq: organizationId } },
      });
      await this.quests.updateMany(
        {
          projectId: { eq: project.id },
          acceptedBy: { eq: userId },
          completedAt: { isNull: true },
        },
        { acceptedAt: null, acceptedBy: null },
      );
      await this.audits.member.logSuccess("leave", {
        ...this.audits.actor(actor),
        ...this.audits.scope(project.id),
        resourceType: "project",
        resourceId: String(project.id),
        description: project.title,
        ...(!leave ? { metadata: { removedUserId: userId } } : {}),
      });
    },
  });

  protected readonly onOwnershipTransferred = $hook({
    on: "organization:ownership:transferred",
    handler: async ({ organizationId, fromUserId, toUserId }) => {
      const project = await this.projects.getOne({
        where: { organizationId: { eq: organizationId } },
      });
      await this.audits.member.logSuccess("transfer", {
        ...this.audits.actor({ id: fromUserId }),
        ...this.audits.scope(project.id),
        severity: "warning",
        resourceType: "project",
        resourceId: String(project.id),
        description: project.title,
        metadata: { toUserId },
      });
    },
  });
}
