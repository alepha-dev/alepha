import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectExclusions } from "../services/ProjectExclusions.ts";

export class OrganizationHooks {
  protected readonly projects = $repository(projects);
  protected readonly audits = $inject(LoreAudits);
  protected readonly exclusions = $inject(ProjectExclusions);

  protected readonly onMemberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId, actor, leave }) => {
      const project = await this.projects.getOne({
        where: { organizationId: { eq: organizationId } },
      });
      // Removed by an admin, not left: they may not rejoin by themselves
      // until an admin lifts it (#Q3646).
      if (!leave) {
        await this.exclusions.exclude(project.id, userId, actor.id);
      }
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

  /**
   * Inviting someone back is an admin lifting their exclusion: accepting the
   * invitation clears it (#Q3646).
   */
  protected readonly onInvitationAccepted = $hook({
    on: "organization:invitation:accepted",
    handler: async ({ invitation, acceptedBy }) => {
      const project = await this.projects.findOne({
        where: { organizationId: { eq: invitation.organizationId } },
      });
      if (project) await this.exclusions.lift(project.id, acceptedBy.id);
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
