import { ProjectTools } from "@lore/core/mcp";
import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

import { ChatAgentController } from "../../api/controllers/ChatAgentController.ts";
import { ChatMessageController } from "../../api/controllers/ChatMessageController.ts";
import { ChatRoomController } from "../../api/controllers/ChatRoomController.ts";
import type { ChatAgentResource } from "../../api/schemas/chatAgentResourceSchema.ts";

/**
 * Chat from an agent (#E161, #Q3933): the rooms, a room's messages, a
 * message sent as the caller, and the project's chat agents (#E170,
 * #Q4200). Each pairs with a `lore chat ...` command.
 *
 * They call the API's own actions, so its rules are theirs: a private room
 * the caller is not in does not exist here either, and a sent `@lore` starts
 * a run with the caller's rights, under the same pin and limits as the web.
 */
export class ChatTools {
  protected readonly rooms = $inject(ChatRoomController);
  protected readonly messages = $inject(ChatMessageController);
  protected readonly agents = $inject(ChatAgentController);
  protected readonly projectTools = $inject(ProjectTools);

  protected readonly projectParams = {
    project: z
      .integer()
      .describe("Project ID. Required if project_name is not provided.")
      .optional(),
    project_name: z
      .string()
      .describe("Project name (case-insensitive). Alternative to `project`.")
      .optional(),
  };

  chat_room_list = $tool({
    description:
      "List the chat rooms of a project you can see: open rooms and the private rooms you are in, with how many messages and mentions of you are unread in each.",
    title: "List chat rooms",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({ ...this.projectParams }),
      result: z.object({
        rooms: z.array(
          z.object({
            name: z.text(),
            private: z.boolean(),
            archived: z.boolean(),
            joined: z.boolean(),
            unread: z.integer(),
            mentions: z.integer(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projectTools.resolveProjectId(
        params.project,
        params.project_name,
      );
      const [rooms, unread] = await Promise.all([
        this.rooms.listChatRooms({ params: { projectId } }),
        this.messages.getChatUnreadCounts({ params: { projectId } }),
      ]);
      const counts = new Map(unread.items.map((row) => [row.roomId, row]));
      return {
        rooms: rooms.items.map((room) => ({
          name: room.name,
          private: room.private,
          archived: !!room.archivedAt,
          joined: room.joined,
          unread: counts.get(room.id)?.unread ?? 0,
          mentions: counts.get(room.id)?.mentions ?? 0,
        })),
      };
    },
  });

  chat_message_list = $tool({
    description:
      "Read a chat room's latest messages, newest first. Pass `before` (a message id from the last page) for the page before it.",
    title: "Read chat messages",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        room: z
          .string()
          .describe("The room's name, as chat_room_list gives it: `general`."),
        before: z
          .string()
          .describe("A message id: return the messages older than it.")
          .optional(),
        limit: z
          .integer()
          .min(1)
          .max(100)
          .describe("How many, 50 by default.")
          .optional(),
        ...this.projectParams,
      }),
      result: z.object({
        messages: z.array(
          z.object({
            id: z.text(),
            author: z.text(),
            // A message, not a label: `z.text()` caps at 255 (#Q4334).
            body: z.text({ size: "rich" }),
            createdAt: z.text(),
            edited: z.boolean(),
            deleted: z.boolean(),
          }),
        ),
        hasMore: z.boolean(),
      }),
    },
    handler: async ({ params }) => {
      const { projectId, roomId } = await this.room(params);
      const page = await this.messages.listChatMessages({
        params: { projectId, roomId },
        query: {
          ...(params.before ? { before: params.before } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        },
      });
      return {
        messages: page.items.map((message) => ({
          id: message.id,
          author:
            message.agentName ??
            message.agent ??
            message.authorId ??
            "a removed member",
          body: message.body,
          createdAt: message.createdAt,
          edited: !!message.editedAt,
          deleted: !!message.deletedAt,
        })),
        hasMore: page.hasMore,
      };
    },
  });

  chat_message_send = $tool({
    description:
      "Post a message in a chat room, as you. Markdown, 4000 characters at most. `@name` mentions a member who can see the room and notifies them; `@lore`, or a project agent's handle (chat_agent_list), asks that agent, which answers in the room with your rights. `#Q12` references link.",
    title: "Send a chat message",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        room: z.string().describe("The room's name: `general`."),
        body: z.string().describe("The message, in Markdown."),
        ...this.projectParams,
      }),
      result: z.object({ id: z.text() }),
    },
    handler: async ({ params }) => {
      const { projectId, roomId } = await this.room(params);
      const sent = await this.messages.sendChatMessage({
        params: { projectId, roomId },
        body: { body: params.body },
      });
      return { id: sent.id };
    },
  });

  protected readonly agentSchema = z.object({
    handle: z.text(),
    name: z.text(),
    builtin: z.boolean(),
    model: z.text().optional(),
    avatar: z.boolean(),
    pre_prompt: z.text({ size: "rich" }).optional(),
  });

  chat_agent_list = $tool({
    description:
      "List the project's chat agents a message can mention: the built-in `lore` (when AI is on) and the project's own, each with its handle, name and model (none means the instance default). `enabled` is false when AI is off: no agent answers then.",
    title: "List chat agents",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({ ...this.projectParams }),
      result: z.object({
        agents: z.array(this.agentSchema),
        enabled: z.boolean(),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projectTools.resolveProjectId(
        params.project,
        params.project_name,
      );
      const page = await this.agents.listChatAgents({ params: { projectId } });
      return {
        agents: page.items.map((agent) => this.toAgent(agent)),
        enabled: page.enabled,
      };
    },
  });

  chat_agent_get = $tool({
    description:
      "Read one of the project's chat agents by its handle, its pre-prompt (persona and playbook) included.",
    title: "Read a chat agent",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        handle: z.string().describe("The agent's handle: `jarvis`."),
        ...this.projectParams,
      }),
      result: this.agentSchema,
    },
    handler: async ({ params }) => {
      const { projectId, agentId } = await this.agent(params);
      return this.toAgent(
        await this.agents.getChatAgent({ params: { projectId, agentId } }),
      );
    },
  });

  chat_agent_create = $tool({
    description:
      "Create a chat agent in the project (needs chat:agent): a handle members mention (2 to 32 lowercase letters, digits or dashes, not `lore`, not a member's), a display name, its pre-prompt (Markdown: what it does and how it answers, added after Lore's own instructions; every chat reader can read it, so keep secrets out), and an optional model id (empty is the instance default; the AI budget counts tokens whatever the model). An avatar is uploaded with `lore chat agent create --avatar <image>`: MCP carries no file.",
    title: "Create a chat agent",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        handle: z.string().describe("What a message mentions: `jarvis`."),
        name: z.string().describe("The display name: `Jarvis`."),
        pre_prompt: z
          .string()
          .describe("The persona and its playbook, in Markdown.")
          .optional(),
        model: z
          .string()
          .describe("A model id; omit for the instance default.")
          .optional(),
        ...this.projectParams,
      }),
      result: this.agentSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectTools.resolveProjectId(
        params.project,
        params.project_name,
      );
      return this.toAgent(
        await this.agents.createChatAgent({
          params: { projectId },
          body: {
            handle: params.handle,
            name: params.name,
            prePrompt: params.pre_prompt ?? "",
            ...(params.model ? { model: params.model } : {}),
          },
        }),
      );
    },
  });

  chat_agent_update = $tool({
    description:
      "Edit a chat agent by its handle (needs chat:agent): only the fields given change. `new_handle` renames what members mention; `model` set to an empty string goes back to the instance default. The avatar changes with `lore chat agent update --avatar <image>` or `--no-avatar`.",
    title: "Edit a chat agent",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        handle: z.string().describe("The agent's current handle: `jarvis`."),
        new_handle: z.string().describe("Its new handle.").optional(),
        name: z.string().describe("Its new display name.").optional(),
        pre_prompt: z
          .string()
          .describe("Its new persona and playbook, in Markdown.")
          .optional(),
        model: z
          .string()
          .describe("A model id, or an empty string for the default.")
          .optional(),
        ...this.projectParams,
      }),
      result: this.agentSchema,
    },
    handler: async ({ params }) => {
      const { projectId, agentId } = await this.agent(params);
      return this.toAgent(
        await this.agents.updateChatAgent({
          params: { projectId, agentId },
          body: {
            ...(params.new_handle ? { handle: params.new_handle } : {}),
            ...(params.name ? { name: params.name } : {}),
            ...(params.pre_prompt !== undefined
              ? { prePrompt: params.pre_prompt }
              : {}),
            ...(params.model !== undefined
              ? { model: params.model.trim() ? params.model : null }
              : {}),
          },
        }),
      );
    },
  });

  chat_agent_delete = $tool({
    description:
      "Delete a chat agent by its handle (needs chat:agent). Its past answers keep showing with its name and avatar, and its handle is free for another agent.",
    title: "Delete a chat agent",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: z.object({
        handle: z.string().describe("The agent's handle: `jarvis`."),
        ...this.projectParams,
      }),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const { projectId, agentId } = await this.agent(params);
      await this.agents.deleteChatAgent({ params: { projectId, agentId } });
      return { ok: true };
    },
  });

  protected toAgent(agent: ChatAgentResource) {
    return {
      handle: agent.handle,
      name: agent.name,
      builtin: agent.builtin,
      ...(agent.model ? { model: agent.model } : {}),
      avatar: !!agent.avatarId,
      ...(agent.prePrompt !== undefined ? { pre_prompt: agent.prePrompt } : {}),
    };
  }

  /**
   * A project's own agent by its handle; the built-in `lore` is not one.
   */
  protected async agent(params: {
    handle: string;
    project?: number;
    project_name?: string;
  }): Promise<{ projectId: number; agentId: string }> {
    const projectId = await this.projectTools.resolveProjectId(
      params.project,
      params.project_name,
    );
    const wanted = params.handle.replace(/^@/, "").toLowerCase();
    const page = await this.agents.listChatAgents({ params: { projectId } });
    const agent = page.items.find((it) => !it.builtin && it.handle === wanted);
    if (!agent) {
      throw new NotFoundError(
        `No agent @${wanted} in this project: chat_agent_list gives their handles.`,
      );
    }
    return { projectId, agentId: agent.id };
  }

  /**
   * A room by its name, among those the caller can see: a private room they
   * are not in is as unknown here as it is everywhere.
   */
  protected async room(params: {
    room: string;
    project?: number;
    project_name?: string;
  }): Promise<{ projectId: number; roomId: string }> {
    const projectId = await this.projectTools.resolveProjectId(
      params.project,
      params.project_name,
    );
    const rooms = await this.rooms.listChatRooms({ params: { projectId } });
    const room = rooms.items.find(
      (it) => it.name === params.room.replace(/^#/, "").toLowerCase(),
    );
    if (!room) {
      throw new NotFoundError(
        `No room named "${params.room}" here that you can see: chat_room_list gives their names.`,
      );
    }
    return { projectId, roomId: room.id };
  }
}
