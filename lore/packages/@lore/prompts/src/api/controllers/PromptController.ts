import { $ownsProject, AgentJobs, PromptRegistry } from "@lore/core/api";
import {
  PROMPT_ARG_TYPES,
  PROMPT_NAME_PATTERN,
  agentRunSchema,
  promptResourceSchema,
} from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { promptCreateSchema } from "../schemas/promptCreateSchema.ts";
import { promptWriteSchema } from "../schemas/promptWriteSchema.ts";
import { PromptRunService } from "../services/PromptRunService.ts";
import { PromptService } from "../services/PromptService.ts";
import { PromptTriggers } from "../services/PromptTriggers.ts";

/**
 * A project's prompts (#E174, #Q4274): the built-ins merged with the
 * project's rows, and its custom prompts. Every member reads and renders
 * them (reading and copying a prompt needs no settings permission);
 * `prompt:manage` writes them.
 */
export class PromptController {
  protected readonly service = $inject(PromptService);
  protected readonly runs = $inject(PromptRunService);
  protected readonly triggers = $inject(PromptTriggers);
  protected readonly agents = $inject(AgentJobs);
  protected readonly registry = $inject(PromptRegistry);

  protected readonly nameParams = z.object({
    projectId: z.integer(),
    name: z.text({ maxLength: 64 }),
  });

  listPrompts = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "project:read",
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/prompts",
    description:
      "The project's prompts: the built-ins it can use, then its custom prompts.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(promptResourceSchema),
        /** When every prompt's trigger was paused (#Q4277). */
        pausedAt: z.string().optional(),
        /**
         * The pages a prompt can be pinned to (#Q4284), and the item type
         * each gives.
         */
        pages: z.array(
          z.object({
            key: z.text({ maxLength: 32 }),
            label: z.text({ maxLength: 64 }),
            gives: z.enum(PROMPT_ARG_TYPES).optional(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const pausedAt = await this.triggers.pausedAt(params.projectId);
      return {
        pages: this.registry.pages(),
        items: await this.service.list(params.projectId),
        ...(pausedAt ? { pausedAt } : {}),
      };
    },
  });

  /**
   * Pauses every prompt's trigger in the project, or resumes them
   * (#Q4277). A run by hand is never paused.
   */
  setPromptsPaused = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "prompt:manage",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/prompts-paused",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ paused: z.boolean() }),
      response: z.object({ pausedAt: z.string().optional() }),
    },
    handler: async ({ params, body }) => {
      await this.triggers.setPaused(params.projectId, body.paused);
      const pausedAt = await this.triggers.pausedAt(params.projectId);
      return pausedAt ? { pausedAt } : {};
    },
  });

  getPrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "project:read",
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/prompts/:name",
    schema: { params: this.nameParams, response: promptResourceSchema },
    handler: ({ params }) => this.service.get(params.projectId, params.name),
  });

  createPrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "prompt:manage",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/prompts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: promptCreateSchema,
      response: promptResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.create(params.projectId, user, body),
  });

  updatePrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "prompt:manage",
      }),
    ],
    method: "PATCH",
    path: "/projects/:projectId/prompts/:name",
    schema: {
      params: this.nameParams,
      body: promptWriteSchema,
      response: promptResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.update(params.projectId, user, params.name, body),
  });

  deletePrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "prompt:manage",
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/prompts/:name",
    schema: { params: this.nameParams, response: okSchema },
    handler: async ({ params }) => {
      await this.service.remove(params.projectId, params.name);
      return { ok: true };
    },
  });

  duplicatePrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "prompt:manage",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/prompts/:name/duplicate",
    schema: {
      params: this.nameParams,
      body: z.object({
        name: z.string().regex(PROMPT_NAME_PATTERN),
        title: z.string().min(1).max(120).optional(),
      }),
      response: promptResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.duplicate(params.projectId, user, params.name, body),
  });

  /**
   * What one arg's select lists (#Q4280): the project's items of its type
   * whose status it accepts.
   */
  listPromptArgOptions = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "project:read",
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/prompts/:name/args/:arg",
    schema: {
      params: z.object({
        projectId: z.integer(),
        name: z.text({ maxLength: 64 }),
        arg: z.text({ maxLength: 32 }),
      }),
      response: z.object({
        items: z.array(z.object({ value: z.string(), label: z.string() })),
      }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.argOptions(
        params.projectId,
        user,
        params.name,
        params.arg,
      ),
    }),
  });

  /**
   * The Agent hosts a run may pick (#Q4280): each one available. Empty, no
   * Run is offered.
   */
  listPromptHosts = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "host:read",
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/prompt-hosts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ hosts: z.array(z.string()) }),
    },
    handler: async ({ params }) => ({
      hosts: [
        ...new Set(
          (await this.agents.choices(params.projectId)).map((it) => it.host),
        ),
      ],
    }),
  });

  /**
   * The text with its args filled, each item read with the caller's
   * permissions: what Copy puts on the clipboard.
   */
  renderPrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "project:read",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/prompts/:name/render",
    schema: {
      params: this.nameParams,
      body: z.object({
        args: z.record(z.text({ maxLength: 32 }), z.text({ maxLength: 120 })),
      }),
      response: z.object({ text: z.string() }),
    },
    handler: async ({ params, body, user }) => ({
      text: (
        await this.service.render(
          params.projectId,
          user,
          params.name,
          body.args,
        )
      ).text,
    }),
  });

  /**
   * Run a prompt on an Agent host (#Q4275): a value per arg, and where it
   * runs. No source and no ref: they are the prompt's. The starter needs
   * the prompt's own permission besides `host:read`.
   */
  runPrompt = $action({
    use: [
      $ownsProject({
        param: "projectId",
        capability: "prompts",
        requires: "host:read",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/prompts/:name/run",
    schema: {
      params: this.nameParams,
      body: z.object({
        args: z
          .record(z.text({ maxLength: 32 }), z.text({ maxLength: 120 }))
          .optional(),
        host: agentRunSchema.shape.host,
        agent: agentRunSchema.shape.agent,
        model: agentRunSchema.shape.model,
        fix: z.boolean().optional(),
        trust: z.boolean().optional(),
      }),
      response: z.object({
        jobId: z.uuid(),
        /** Feedback items a triage left out for want of a member's trust. */
        skipped: z.array(z.integer()),
      }),
    },
    handler: ({ params, body, user }) =>
      this.runs.run(params.projectId, user, params.name, body),
  });
}
