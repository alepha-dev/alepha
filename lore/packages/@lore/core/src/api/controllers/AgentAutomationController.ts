import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { agentAutomationCreateSchema } from "../schemas/agentAutomationCreateSchema.ts";
import { agentAutomationResourceSchema } from "../schemas/agentAutomationResourceSchema.ts";
import { agentAutomationRunResultSchema } from "../schemas/agentAutomationRunResultSchema.ts";
import { agentAutomationWriteSchema } from "../schemas/agentAutomationWriteSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AgentAutomationService } from "../services/AgentAutomationService.ts";

/**
 * A project's agent automations (#E172, #Q4226): read with `host:read`,
 * written and run with `automation:manage`. An automation is addressed by
 * its id or its name, which is what `lore automation <verb> <name>` takes.
 */
export class AgentAutomationController {
  protected readonly service = $inject(AgentAutomationService);

  listProjectAutomations = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "GET",
    path: "/projects/:projectId/automations",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(agentAutomationResourceSchema) }),
    },
    handler: async ({ params }) => ({
      items: await this.service.list(params.projectId),
    }),
  });

  getProjectAutomation = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "GET",
    path: "/projects/:projectId/automations/:automation",
    schema: {
      params: z.object({
        projectId: z.integer(),
        automation: z.text({ maxLength: 64 }),
      }),
      response: agentAutomationResourceSchema,
    },
    handler: ({ params }) =>
      this.service.find(params.projectId, params.automation),
  });

  createProjectAutomation = $action({
    use: [$ownsProject({ param: "projectId", requires: "automation:manage" })],
    method: "POST",
    path: "/projects/:projectId/automations",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: agentAutomationCreateSchema,
      response: agentAutomationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.create(params.projectId, user.id, body),
  });

  updateProjectAutomation = $action({
    use: [$ownsProject({ param: "projectId", requires: "automation:manage" })],
    method: "PATCH",
    path: "/projects/:projectId/automations/:automation",
    schema: {
      params: z.object({
        projectId: z.integer(),
        automation: z.text({ maxLength: 64 }),
      }),
      body: agentAutomationWriteSchema,
      response: agentAutomationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.update(params.projectId, params.automation, user.id, body),
  });

  deleteProjectAutomation = $action({
    use: [$ownsProject({ param: "projectId", requires: "automation:manage" })],
    method: "DELETE",
    path: "/projects/:projectId/automations/:automation",
    schema: {
      params: z.object({
        projectId: z.integer(),
        automation: z.text({ maxLength: 64 }),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.service.remove(params.projectId, params.automation);
      return { ok: true };
    },
  });

  /**
   * Runs an automation once, by hand, as the caller: whether it is enabled
   * and whether there is something to do are not asked.
   */
  runProjectAutomation = $action({
    use: [$ownsProject({ param: "projectId", requires: "automation:manage" })],
    method: "POST",
    path: "/projects/:projectId/automations/:automation/run",
    schema: {
      params: z.object({
        projectId: z.integer(),
        automation: z.text({ maxLength: 64 }),
      }),
      response: agentAutomationRunResultSchema,
    },
    handler: async ({ params, user }) =>
      this.service.run(
        await this.service.find(params.projectId, params.automation),
        { startedBy: user.id },
      ),
  });
}
