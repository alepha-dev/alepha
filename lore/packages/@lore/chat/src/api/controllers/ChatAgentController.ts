import { $ownsProject } from "@lore/core/api";
import { $inject, Alepha, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { chatAgentBudgetResourceSchema } from "../schemas/chatAgentBudgetResourceSchema.ts";
import {
  chatAgentBodySchema,
  chatAgentResourceSchema,
} from "../schemas/chatAgentResourceSchema.ts";
import { ChatAgentBudgetService } from "../services/ChatAgentBudgetService.ts";
import { ChatAgentService } from "../services/ChatAgentService.ts";
import { ChatBuckets } from "../services/ChatBuckets.ts";

/**
 * A project's chat agents (#E170, #Q4196). Reading them is `chat:read`, a
 * pre-prompt included; creating, editing and deleting is `chat:agent`.
 * Mentioning one is a message, `chat:write`.
 */
export class ChatAgentController {
  protected readonly service = $inject(ChatAgentService);
  protected readonly budgets = $inject(ChatAgentBudgetService);
  protected readonly alepha = $inject(Alepha);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId", capability: "chat" });

  protected readonly agentParams = z.object({
    projectId: z.integer(),
    /**
     * A project agent's id, or `lore`: the built-in's engine is the
     * project's to set (#Q4250).
     */
    agentId: z.union([z.uuid(), z.literal("lore")]),
  });

  listChatAgents = $action({
    method: "GET",
    path: "/projects/:projectId/chat/agents",
    use: [this.ownsProject("chat:read")],
    description:
      "The project's agents: the built-in `lore` first (when AI is on for this Lore), then the project's own. `enabled` is false with AI off: the agents are listed, and none answers a mention.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(chatAgentResourceSchema),
        /**
         * Whether a mention starts a run here: AI is on.
         */
        enabled: z.boolean(),
      }),
    },
    handler: async ({ params }) => ({
      items: await this.service.list(params.projectId),
      enabled: this.service.enabled(),
    }),
  });

  /**
   * The project's AI budget for its agents (#Q4237) and what it paid for
   * over the window. Readable with the agents.
   */
  getChatAgentBudget = $action({
    method: "GET",
    path: "/projects/:projectId/chat/agent-budget",
    use: [this.ownsProject("chat:read")],
    description:
      "The project's AI budget for its chat agents: `tokens` per `windowHours` (absent with none), what its agents' runs spent over the window, and `freesAt` while it is spent. A run draws on it first, then on the mentioner's own budget.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: chatAgentBudgetResourceSchema,
    },
    handler: async ({ params }) => this.budgets.status(params.projectId),
  });

  /**
   * Sets the project's AI budget for its agents, or removes it with
   * `tokens: null` (#Q4237).
   */
  setChatAgentBudget = $action({
    method: "PUT",
    path: "/projects/:projectId/chat/agent-budget",
    use: [this.ownsProject("chat:agent")],
    description:
      "Set the project's AI budget for its chat agents, in tokens per window, or remove it with `tokens: null`.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        tokens: z.integer().min(1000).max(100_000_000).nullable(),
      }),
      response: chatAgentBudgetResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.budgets.setLimit(
        params.projectId,
        body.tokens ?? undefined,
        user!.id,
      );
      return this.budgets.status(params.projectId);
    },
  });

  getChatAgent = $action({
    method: "GET",
    path: "/projects/:projectId/chat/agents/:agentId",
    use: [this.ownsProject("chat:read")],
    description: "One of the project's agents, its pre-prompt included.",
    schema: {
      params: this.agentParams,
      response: chatAgentResourceSchema,
    },
    handler: async ({ params }) =>
      this.service.get(params.projectId, params.agentId),
  });

  createChatAgent = $action({
    method: "POST",
    path: "/projects/:projectId/chat/agents",
    use: [this.ownsProject("chat:agent")],
    description:
      "Create an agent: a `handle` a message mentions (2 to 32 lowercase letters, digits or dashes, not `lore`, not a member's), a `name`, a `prePrompt` (its persona and playbook), an optional `model` and an optional `avatar`, an image uploaded to the `chat-agent-avatars` bucket.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: chatAgentBodySchema,
      response: chatAgentResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.service.create(params.projectId, user!, body),
  });

  updateChatAgent = $action({
    method: "PATCH",
    path: "/projects/:projectId/chat/agents/:agentId",
    use: [this.ownsProject("chat:agent")],
    description:
      "Edit an agent: only the fields given change; `avatar` or `model` set to null is removed.",
    schema: {
      params: this.agentParams,
      body: chatAgentBodySchema.partial(),
      response: chatAgentResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.service.update(params.projectId, params.agentId, user!, body),
  });

  uploadChatAgentAvatar = $action({
    method: "POST",
    path: "/projects/:projectId/chat/agents/avatar",
    use: [this.ownsProject("chat:agent")],
    description:
      "Upload an image (JPEG, PNG, GIF or WebP, 2 MB at most) to use as an agent's avatar. Pass the `fileId` as `avatar` to create or update the agent.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ file: z.file({ maxBytes: 2 * 1024 * 1024 }) }),
      response: z.object({ fileId: z.uuid(), url: z.text() }),
    },
    handler: async ({ body, user }) => {
      // Resolved here, not held as a field: a controller stays pure.
      const file = await this.alepha
        .inject(ChatBuckets)
        .agentAvatars.upload(body.file, { user });
      return { fileId: file.id, url: `/api/files/${file.id}` };
    },
  });

  deleteChatAgent = $action({
    method: "DELETE",
    path: "/projects/:projectId/chat/agents/:agentId",
    use: [this.ownsProject("chat:agent")],
    description:
      "Delete an agent: its handle is free again, and its past answers keep its name and avatar.",
    schema: {
      params: this.agentParams,
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.service.remove(params.projectId, params.agentId);
      return { ok: true };
    },
  });
}
