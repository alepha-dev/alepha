import { projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { ChatRoomService } from "../services/ChatRoomService.ts";

/**
 * A member who leaves the project, or is removed from it, leaves every room
 * of it (#E161, #Q3925): a private room must not outlive the membership that
 * gave access to it.
 */
export class ChatRoomHooks {
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly projects = $repository(projects);

  protected readonly onMemberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId }) => {
      const project = await this.projects.findOne({
        where: { organizationId: { eq: organizationId } },
      });
      if (!project) {
        return;
      }
      await this.rooms.leaveProject(project.id, userId);
    },
  });
}
