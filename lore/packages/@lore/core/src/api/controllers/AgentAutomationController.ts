import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { agentAutomationCreateSchema } from "../schemas/agentAutomationCreateSchema.ts";
import { agentAutomationResourceSchema } from "../schemas/agentAutomationResourceSchema.ts";
import { agentAutomationRunResultSchema } from "../schemas/agentAutomationRunResultSchema.ts";
import { agentAutomationSettingsSchema } from "../schemas/agentAutomationSettingsSchema.ts";
import { agentAutomationWriteSchema } from "../schemas/agentAutomationWriteSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AgentAutomationService } from "../services/AgentAutomationService.ts";

/**
 * A project's agent automations (#E172, #Q4226): read with `host:read`,
 * written and run with `prompt:manage`. An automation is addressed by
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
    use: [$ownsProject({ param: "projectId", requires: "prompt:manage" })],
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
    use: [$ownsProject({ param: "projectId", requires: "prompt:manage" })],
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
    use: [$ownsProject({ param: "projectId", requires: "prompt:manage" })],
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
    use: [$ownsProject({ param: "projectId", requires: "prompt:manage" })],
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

  /**
   * The project's pause and its daily build ceiling (#Q4230).
   */
  getProjectAutomationSettings = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "GET",
    path: "/projects/:projectId/automation-settings",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: agentAutomationSettingsSchema,
    },
    handler: ({ params }) => this.settings(params.projectId),
  });

  /**
   * Pauses or resumes every automation of the project, and sets its daily
   * build ceiling (`null` for the default). A run by hand works while
   * paused.
   */
  setProjectAutomationSettings = $action({
    use: [$ownsProject({ param: "projectId", requires: "prompt:manage" })],
    method: "POST",
    path: "/projects/:projectId/automation-settings",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        paused: z.boolean().optional(),
        buildsPerDay: z.integer().min(0).max(1000).nullable().optional(),
      }),
      response: agentAutomationSettingsSchema,
    },
    handler: async ({ params, body }) => {
      if (body.paused !== undefined) {
        await this.service.setPaused(params.projectId, body.paused);
      }
      if (body.buildsPerDay !== undefined) {
        await this.service.setBuildsPerDay(params.projectId, body.buildsPerDay);
      }
      return this.settings(params.projectId);
    },
  });

  protected async settings(projectId: number) {
    const pausedAt = await this.service.pausedAt(projectId);
    return {
      ...(pausedAt ? { pausedAt } : {}),
      buildsPerDay: await this.service.buildsPerDay(projectId),
    };
  }
}
