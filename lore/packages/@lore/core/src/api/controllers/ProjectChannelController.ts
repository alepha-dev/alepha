import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { projectChannelResourceSchema } from "../schemas/projectChannelResourceSchema.ts";
import { projectChannelWriteBodySchema } from "../schemas/projectChannelWriteBodySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectChannelService } from "../services/ProjectChannelService.ts";

/**
 * Settings > Automations > Channels (#Q3614): a project's channels, never a
 * URL. Writes need `automation:manage`, the service checks it.
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
  createProjectChannel = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/channels",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z
        .object({
          name: z.string().min(1).max(64),
          url: z.string().min(1).max(2048),
        })
        .strict(),
      response: projectChannelResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.add(params.projectId, user, body),
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
