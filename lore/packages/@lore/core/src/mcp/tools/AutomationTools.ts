import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { AgentAutomationController } from "../../api/controllers/AgentAutomationController.ts";
import { AgentAutomationService } from "../../api/services/AgentAutomationService.ts";
import {
  automationCreateParamsSchema,
  automationDeleteResultSchema,
  automationListParamsSchema,
  automationListResultSchema,
  automationNameParamsSchema,
  automationResultSchema,
  automationRunResultSchema,
  automationSettingsParamsSchema,
  automationSettingsResultSchema,
  automationUpdateParamsSchema,
} from "../schemas/automationSchemas.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * Agent automations, for agents (#Q4231): the twins of `lore automation`,
 * never wider. Each goes through the page's own action: reading is
 * `host:read`, writing and running `automation:manage`.
 */
export class AutomationTools {
  protected readonly automations = $inject(AgentAutomationController);
  protected readonly service = $inject(AgentAutomationService);
  protected readonly projects = $inject(ProjectTools);

  automation_list = $tool({
    title: "List agent automations",
    description:
      "The project's agent automations: each one's prompt (triage, build or text), where it runs (host, agent, model), its trigger in `on`'s form, whether it is enabled, its last run and job, its next scheduled run, and why it last skipped. Readable with host:read.",
    annotations: { readOnlyHint: true },
    schema: {
      params: automationListParamsSchema,
      result: automationListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      const { items } = await this.automations.listProjectAutomations({
        params: { projectId },
      });
      return {
        automations: items.map((it) => ({ ...it, on: this.service.onOf(it) })),
      };
    },
  });

  automation_create = $tool({
    title: "Create an agent automation",
    description:
      "Create an agent automation (needs automation:manage): a prompt run on one of the project's Agent hosts by hand, on project events or on a schedule. A build automation turns every todo quest not tagged `needs-human` into a pull request. Runs are bounded by ceilings and stop themselves after three failures in a row.",
    schema: {
      params: automationCreateParamsSchema,
      result: automationResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.automations.createProjectAutomation({
        params: { projectId },
        body: {
          name: params.name,
          promptKind: params.prompt,
          ...this.write(params),
          ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
        },
      });
    },
  });

  automation_update = $tool({
    title: "Change an agent automation",
    description:
      "Change an agent automation by its name (needs automation:manage): only the fields given change; `enabled` turns its trigger on or off, an empty string clears host, agent or model.",
    schema: {
      params: automationUpdateParamsSchema,
      result: automationResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.automations.updateProjectAutomation({
        params: { projectId, automation: params.name },
        body: {
          ...(params.new_name ? { name: params.new_name } : {}),
          ...(params.prompt ? { promptKind: params.prompt } : {}),
          ...this.write(params),
          ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
        },
      });
    },
  });

  automation_delete = $tool({
    title: "Delete an agent automation",
    description:
      "Delete an agent automation by its name (needs automation:manage). Its past jobs stay.",
    annotations: { destructiveHint: true },
    schema: {
      params: automationNameParamsSchema,
      result: automationDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      await this.automations.deleteProjectAutomation({
        params: { projectId, automation: params.name },
      });
      return { ok: true };
    },
  });

  automation_run = $tool({
    title: "Run an agent automation",
    description:
      "Run an agent automation once, by hand, as you (needs automation:manage): whether it is enabled, paused or under a ceiling is not asked. Answers the jobs it started (job_get reads one), or why it started none. Called with an agent job's own key, it is refused: a job never starts another.",
    schema: {
      params: automationNameParamsSchema,
      result: automationRunResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.automations.runProjectAutomation({
        params: { projectId, automation: params.name },
      });
    },
  });

  automation_pause_all = $tool({
    title: "Pause every agent automation",
    description:
      "Pause every agent automation of the project (needs automation:manage): no event or schedule starts a run until automation_resume_all. A run by hand still works.",
    schema: {
      params: automationListParamsSchema,
      result: automationSettingsResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.automations.setProjectAutomationSettings({
        params: { projectId },
        body: { paused: true },
      });
    },
  });

  automation_resume_all = $tool({
    title: "Resume the agent automations",
    description:
      "Resume the project's agent automations after automation_pause_all (needs automation:manage).",
    schema: {
      params: automationListParamsSchema,
      result: automationSettingsResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.automations.setProjectAutomationSettings({
        params: { projectId },
        body: { paused: false },
      });
    },
  });

  automation_settings = $tool({
    title: "Read or set the automations' settings",
    description:
      "Whether the project's agent automations are paused, and the daily ceiling on builds they start (20 unless set). Pass `builds_per_day` to change it (needs automation:manage).",
    schema: {
      params: automationSettingsParamsSchema,
      result: automationSettingsResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      if (params.builds_per_day === undefined) {
        return this.automations.getProjectAutomationSettings({
          params: { projectId },
        });
      }
      return this.automations.setProjectAutomationSettings({
        params: { projectId },
        body: { buildsPerDay: params.builds_per_day },
      });
    },
  });

  protected project(params: {
    project?: number;
    project_name?: string;
  }): Promise<number> {
    return this.projects.resolveProjectId(params.project, params.project_name);
  }

  /**
   * The fields create and update share, in the action's names.
   */
  protected write(params: {
    text?: string;
    host?: string;
    agent?: string;
    model?: string;
    room?: string;
    source?: "none" | "read" | "write" | "";
    ref?: string;
    on?: string;
    only_if_work?: boolean;
    auto_merge?: boolean;
    concurrency?: number;
    settle_seconds?: number;
    max_runs_per_hour?: number;
    max_runs_per_day?: number;
  }) {
    return {
      ...(params.text === undefined ? {} : { promptText: params.text }),
      ...(params.host === undefined ? {} : { host: params.host }),
      ...(params.agent === undefined ? {} : { agent: params.agent }),
      ...(params.model === undefined ? {} : { model: params.model }),
      ...(params.room === undefined ? {} : { room: params.room }),
      ...(params.source === undefined ? {} : { source: params.source }),
      ...(params.ref === undefined ? {} : { ref: params.ref }),
      ...(params.on === undefined ? {} : { on: params.on }),
      ...(params.only_if_work === undefined
        ? {}
        : { onlyIfWork: params.only_if_work }),
      ...(params.auto_merge === undefined
        ? {}
        : { autoMerge: params.auto_merge }),
      ...(params.concurrency === undefined
        ? {}
        : { concurrency: params.concurrency }),
      ...(params.settle_seconds === undefined
        ? {}
        : { settleSeconds: params.settle_seconds }),
      ...(params.max_runs_per_hour === undefined
        ? {}
        : { maxRunsPerHour: params.max_runs_per_hour }),
      ...(params.max_runs_per_day === undefined
        ? {}
        : { maxRunsPerDay: params.max_runs_per_day }),
    };
  }
}
