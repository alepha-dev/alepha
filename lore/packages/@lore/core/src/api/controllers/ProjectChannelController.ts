import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { channelRoomSchema } from "../schemas/channelRoomSchema.ts";
import { projectChannelCreateBodySchema } from "../schemas/projectChannelCreateBodySchema.ts";
import { projectChannelCreatedSchema } from "../schemas/projectChannelCreatedSchema.ts";
import { projectChannelResourceSchema } from "../schemas/projectChannelResourceSchema.ts";
import { projectChannelWriteBodySchema } from "../schemas/projectChannelWriteBodySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectChannelService } from "../services/ProjectChannelService.ts";

/**
 * A project's notification channels (#Q3614, #Q3891, #Q3900): Discord
 * channels and webhook endpoints. Never a Discord URL; a webhook's secret
 * once, on create and on rotate. The service checks the permissions.
 */
export class ProjectChannelController {
  protected readonly service = $inject(ProjectChannelService);
  protected readonly gate = $ownsProject({ param: "projectId" });

  listProjectChannels = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/channels",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(projectChannelResourceSchema) }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.list(params.projectId, user),
    }),
  });
  /**
   * The chat rooms a channel may post into (#Q4052): the room picker of
   * Add a channel.
   */
  listProjectChannelRooms = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/channels/rooms",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(channelRoomSchema) }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.rooms(params.projectId, user),
    }),
  });
  createProjectChannel = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/channels",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: projectChannelCreateBodySchema,
      response: projectChannelCreatedSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.add(params.projectId, user, body),
  });
  rotateProjectChannelSecret = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/channels/:id/rotate",
    schema: {
      params: z.object({ projectId: z.integer(), id: z.string().max(64) }),
      response: projectChannelCreatedSchema,
    },
    handler: ({ params, user }) =>
      this.service.rotate(params.projectId, user, params.id),
  });
  updateProjectChannel = $action({
    use: [this.gate],
    method: "PATCH",
    path: "/projects/:projectId/channels/:id",
    schema: {
      params: z.object({ projectId: z.integer(), id: z.string().max(64) }),
      body: projectChannelWriteBodySchema,
      response: projectChannelResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.update(params.projectId, user, params.id, body),
  });
  deleteProjectChannel = $action({
    use: [this.gate],
    method: "DELETE",
    path: "/projects/:projectId/channels/:id",
    schema: {
      params: z.object({ projectId: z.integer(), id: z.string().max(64) }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.service.remove(params.projectId, user, params.id);
      return { ok: true };
    },
  });
}
