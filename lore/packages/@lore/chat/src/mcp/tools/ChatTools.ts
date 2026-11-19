import { ProjectTools } from "@lore/core/mcp";
import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

import { ChatMessageController } from "../../api/controllers/ChatMessageController.ts";
import { ChatRoomController } from "../../api/controllers/ChatRoomController.ts";

/**
 * Chat from an agent (#E161, #Q3933): the rooms, a room's messages, and a
 * message sent as the caller. Each pairs with a `lore chat ...` command.
 *
 * They call the API's own actions, so its rules are theirs: a private room
 * the caller is not in does not exist here either, and a sent `@lore` starts
 * a run with the caller's rights, under the same pin and limits as the web.
 */
export class ChatTools {
  protected readonly rooms = $inject(ChatRoomController);
  protected readonly messages = $inject(ChatMessageController);
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
            body: z.text(),
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
          author: message.agent ?? message.authorId ?? "a removed member",
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
      "Post a message in a chat room, as you. Markdown, 4000 characters at most. `@name` mentions a member who can see the room and notifies them; `@lore` asks the Lore agent, which answers in the room with your rights. `#Q12` references link.",
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
