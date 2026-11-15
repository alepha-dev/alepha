import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { automationChannelResourceSchema } from "../schemas/automationChannelResourceSchema.ts";
import { automationChannelWriteBodySchema } from "../schemas/automationChannelWriteBodySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AutomationChannelService } from "../services/AutomationChannelService.ts";

/**
 * Settings > Automations > Channels (#Q3614): a project's channels, never a
 * URL. Writes need `automation:manage`, the service checks it.
 */
export class AutomationChannelController {
  protected readonly service = $inject(AutomationChannelService);
  protected readonly gate = $ownsProject({ param: "projectId" });

  listAutomationChannels = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/automation-channels",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(automationChannelResourceSchema) }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.list(params.projectId, user),
    }),
  });
  createAutomationChannel = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/automation-channels",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z
        .object({
          name: z.string().min(1).max(64),
          url: z.string().min(1).max(2048),
        })
        .strict(),
      response: automationChannelResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.add(params.projectId, user, body),
  });
  updateAutomationChannel = $action({
    use: [this.gate],
    method: "PATCH",
    path: "/projects/:projectId/automation-channels/:id",
    schema: {
      params: z.object({ projectId: z.integer(), id: z.string().max(64) }),
      body: automationChannelWriteBodySchema,
      response: automationChannelResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.update(params.projectId, user, params.id, body),
  });
  deleteAutomationChannel = $action({
    use: [this.gate],
    method: "DELETE",
    path: "/projects/:projectId/automation-channels/:id",
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
