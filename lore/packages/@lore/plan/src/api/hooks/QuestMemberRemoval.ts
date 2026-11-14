import { projects } from "@lore/core/schemas";
import { $hook } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";

/**
 * A member who leaves a project, or is removed from it, hands back the quests
 * they had accepted and not completed: they return to the backlog rather than
 * stay assigned to somebody who can no longer work them.
 *
 * Work's own subscriber to the organization event (#E75, #Q2623): core's
 * `OrganizationHooks` audits the departure and reads no quest.
 */
export class QuestMemberRemoval {
  protected readonly projects = $repository(projects);
  protected readonly quests = $repository(quests);

  protected readonly onMemberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId }) => {
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
    },
  });
}
