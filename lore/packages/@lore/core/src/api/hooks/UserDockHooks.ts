import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { UserDockService } from "../services/UserDockService.ts";

/**
 * Keeps each dock in step with the memberships behind it (#E139).
 *
 * - An accepted invitation pins the project for the user who accepted it
 *   (#Q3435). It is the only way to join a project: `MemberService.add` has
 *   no route. A full dock leaves it unpinned, and the accept answer says so.
 * - Leaving a project, or being removed from it, unpins it (#Q3436): one
 *   event for both, `leave` telling them apart.
 *
 * Archiving is not an event: `ProjectController.setArchived` unpins for every
 * member itself.
 */
export class UserDockHooks {
  protected readonly log = $logger();
  protected readonly dock = $inject(UserDockService);
  protected readonly projects = $repository(projects);

  protected readonly onInvitationAccepted = $hook({
    on: "organization:invitation:accepted",
    handler: async ({ invitation, acceptedBy }) => {
      const project = await this.projects.findOne({
        where: { organizationId: { eq: invitation.organizationId } },
      });
      if (!project) {
        return;
      }
      try {
        await this.dock.pin(acceptedBy.id, project.id);
      } catch (error) {
        // A missing pin must never undo a join: the user is in the project
        // and can pin it from All projects.
        this.log.warn("Could not pin the project an invitation joined", {
          projectId: project.id,
          error,
        });
      }
    },
  });

  protected readonly onMemberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId }) => {
      const project = await this.projects.findOne({
        where: { organizationId: { eq: organizationId } },
      });
      if (!project) {
        return;
      }
      await this.dock.unpin(userId, project.id);
    },
  });
}
