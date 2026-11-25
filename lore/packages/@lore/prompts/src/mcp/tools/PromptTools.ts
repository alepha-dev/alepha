import { JobKeyService } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import {
  PROMPT_ARG_TYPES,
  type PromptArg,
  type PromptArgType,
  projectParamsSchema,
  promptResourceSchema,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, ForbiddenError, okSchema } from "alepha/server";

import { PromptController } from "../../api/controllers/PromptController.ts";
import type { PromptWrite } from "../../api/schemas/promptWriteSchema.ts";
import {
  promptCreateParamsSchema,
  promptDuplicateParamsSchema,
  promptListResultSchema,
  promptNameParamsSchema,
  promptPausedResultSchema,
  promptRenderParamsSchema,
  promptRenderResultSchema,
  promptRunParamsSchema,
  promptRunResultSchema,
  promptUpdateParamsSchema,
} from "../schemas/promptSchemas.ts";

/**
 * A project's prompts over MCP (#E174, #Q4282), each tool the twin of a
 * `lore prompt` command and doing no more. A job key is refused on every
 * write and on a run: a job never starts a job.
 */
export class PromptTools {
  /**
   * What a prompt is, said once in every description.
   */
  public static readonly WHAT =
    "A prompt is what Lore hands a coding agent: copied (prompt_render) or run on the project's Agent host (prompt_run), built-in or the project's own, with typed args and an optional trigger.";

  protected readonly controller = $inject(PromptController);
  protected readonly projects = $inject(ProjectTools);
  protected readonly keys = $inject(JobKeyService);

  protected project(input: { project?: number; project_name?: string }) {
    return this.projects.resolveProjectId(input.project, input.project_name);
  }

  /**
   * A job key may read prompts, never change or run one.
   */
  protected async refuseJobKey(): Promise<void> {
    if (await this.keys.current()) {
      throw new ForbiddenError(
        "An agent job cannot manage or run prompts: a job never starts a job",
      );
    }
  }

  /**
   * `name:type` or `name:type:status|status`.
   */
  public static argsOf(values: string[]): PromptArg[] {
    return values.map((value) => {
      const [argName, type, accepts] = value.split(":");
      if (!argName || !PROMPT_ARG_TYPES.includes(type as PromptArgType)) {
        throw new BadRequestError(
          `'${value}' is no arg: write name:type or name:type:status|status, a type among ${PROMPT_ARG_TYPES.join(", ")}`,
        );
      }
      return {
        name: argName,
        type: type as PromptArgType,
        ...(accepts ? { accepts: accepts.split("|").filter(Boolean) } : {}),
      };
    });
  }

  /**
   * `arg=reference`, each.
   */
  public static setOf(values: string[] | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const value of values ?? []) {
      const at = value.indexOf("=");
      if (at < 1) {
        throw new BadRequestError(
          `'${value}' is no value: write arg=reference`,
        );
      }
      out[value.slice(0, at)] = value.slice(at + 1);
    }
    return out;
  }

  prompt_list = $tool({
    description: `The project's prompts: the built-ins it can use, then its own, each with its args (and the statuses each accepts), source, trigger, pins and last run. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: projectParamsSchema, result: promptListResultSchema },
    handler: async ({ params }) =>
      this.controller.listPrompts({
        params: { projectId: await this.project(params) },
      }),
  });

  prompt_get = $tool({
    description: `One prompt, its words included. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: promptNameParamsSchema, result: promptResourceSchema },
    handler: async ({ params }) =>
      this.controller.getPrompt({
        params: { projectId: await this.project(params), name: params.name },
      }),
  });

  prompt_create = $tool({
    description: `Create a custom prompt: a name, its words, its args and its source. prompt_update sets its trigger and pins; timeout_seconds sets a run's time. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: { params: promptCreateParamsSchema, result: promptResourceSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.createPrompt({
        params: { projectId: await this.project(params) },
        body: {
          name: params.name,
          text: params.text,
          ...(params.title ? { title: params.title } : {}),
          ...(params.description ? { description: params.description } : {}),
          ...(params.args ? { args: PromptTools.argsOf(params.args) } : {}),
          ...(params.source ? { source: params.source } : {}),
          ...(params.ref ? { ref: params.ref } : {}),
          ...(params.timeout_seconds
            ? { timeoutSeconds: params.timeout_seconds }
            : {}),
        },
      });
    },
  });

  prompt_update = $tool({
    description: `Change a prompt in one call: a custom one's words, title, description and args; on any prompt, built-in included, its source and ref, where it runs (host, agent, model), its trigger (on, check, a stored value per arg with set, its two ceilings), whether it is enabled, the pages it is pinned to, and a run's time (timeout_seconds). Only the fields given change. The events of a trigger are event_catalog's. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: { params: promptUpdateParamsSchema, result: promptResourceSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      const body: PromptWrite = {
        ...(params.text ? { text: params.text } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.description === undefined
          ? {}
          : { description: params.description }),
        ...(params.args ? { args: PromptTools.argsOf(params.args) } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.ref === undefined ? {} : { ref: params.ref || null }),
        ...(params.host === undefined ? {} : { host: params.host || null }),
        ...(params.agent === undefined ? {} : { agent: params.agent || null }),
        ...(params.model === undefined ? {} : { model: params.model || null }),
        ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
        ...(params.on ? { on: params.on } : {}),
        ...(params.check ? { check: params.check } : {}),
        ...(params.set ? { argValues: PromptTools.setOf(params.set) } : {}),
        ...(params.max_per_hour ? { maxRunsPerHour: params.max_per_hour } : {}),
        ...(params.max_per_day ? { maxRunsPerDay: params.max_per_day } : {}),
        ...(params.pins ? { pins: params.pins } : {}),
        ...(params.timeout_seconds === undefined
          ? {}
          : { timeoutSeconds: params.timeout_seconds || null }),
      };
      return this.controller.updatePrompt({
        params: { projectId: await this.project(params), name: params.name },
        body,
      });
    },
  });

  prompt_duplicate = $tool({
    description: `Copy any prompt, a built-in included, into a custom one under a new name: its words, args and source, which no longer follow the built-in. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: promptDuplicateParamsSchema,
      result: promptResourceSchema,
    },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.duplicatePrompt({
        params: { projectId: await this.project(params), name: params.name },
        body: {
          name: params.new_name,
          ...(params.title ? { title: params.title } : {}),
        },
      });
    },
  });

  prompt_delete = $tool({
    description: `Delete a custom prompt; its past jobs stay. A built-in cannot be deleted. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: { params: promptNameParamsSchema, result: okSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.deletePrompt({
        params: { projectId: await this.project(params), name: params.name },
      });
    },
  });

  prompt_render = $tool({
    description: `A prompt's words with its args filled, each item read with your permissions: what Copy puts on the clipboard. An item whose status the arg does not accept is refused. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: promptRenderParamsSchema,
      result: promptRenderResultSchema,
    },
    handler: async ({ params }) =>
      this.controller.renderPrompt({
        params: { projectId: await this.project(params), name: params.name },
        body: { args: PromptTools.setOf(params.set) },
      }),
  });

  prompt_run = $tool({
    description: `Run a prompt on the project's Agent host, its args filled: answers the job's id, which job_get follows. The source is the prompt's own (prompt_update sets it), never given to a run. Needs host:read and the prompt's permission. An agent job cannot run one. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: { params: promptRunParamsSchema, result: promptRunResultSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.runPrompt({
        params: { projectId: await this.project(params), name: params.name },
        body: {
          ...(params.set || !params.continue
            ? { args: PromptTools.setOf(params.set) }
            : {}),
          ...(params.host ? { host: params.host } : {}),
          ...(params.agent ? { agent: params.agent } : {}),
          ...(params.model ? { model: params.model } : {}),
          ...(params.fix ? { fix: true } : {}),
          ...(params.trust ? { trust: true } : {}),
          ...(params.continue ? { continue: params.continue } : {}),
        },
      });
    },
  });

  prompt_pause_all = $tool({
    description: `Pause every prompt's trigger in the project; a run by hand still works. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: { params: projectParamsSchema, result: promptPausedResultSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.setPromptsPaused({
        params: { projectId: await this.project(params) },
        body: { paused: true },
      });
    },
  });

  prompt_resume_all = $tool({
    description: `Resume the project's prompt triggers. Needs prompt:manage. ${PromptTools.WHAT}`,
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: { params: projectParamsSchema, result: promptPausedResultSchema },
    handler: async ({ params }) => {
      await this.refuseJobKey();
      return this.controller.setPromptsPaused({
        params: { projectId: await this.project(params) },
        body: { paused: false },
      });
    },
  });
}
