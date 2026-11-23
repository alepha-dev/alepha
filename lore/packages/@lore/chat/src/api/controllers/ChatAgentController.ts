import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import {
  chatAgentBodySchema,
  chatAgentResourceSchema,
} from "../schemas/chatAgentResourceSchema.ts";
import { ChatAgentService } from "../services/ChatAgentService.ts";

/**
 * A project's chat agents (#E170, #Q4196). Reading them is `chat:read`, a
 * pre-prompt included; creating, editing and deleting is `chat:agent`.
 * Mentioning one is a message, `chat:write`.
 */
export class ChatAgentController {
  protected readonly service = $inject(ChatAgentService);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId", capability: "chat" });

  protected readonly agentParams = z.object({
    projectId: z.integer(),
    agentId: z.uuid(),
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
