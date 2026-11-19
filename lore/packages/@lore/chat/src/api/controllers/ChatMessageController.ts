import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { chatMessageBodySchema } from "../schemas/chatMessageBodySchema.ts";
import { chatMessageResourceSchema } from "../schemas/chatMessageResourceSchema.ts";
import { ChatMessageService } from "../services/ChatMessageService.ts";

/**
 * The messages of a room (#E161, #Q3926). Gated on the `chat` capability and
 * a `chat:*` permission, then on the room's own privacy rule.
 */
export class ChatMessageController {
  protected readonly service = $inject(ChatMessageService);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId", capability: "chat" });

  protected readonly roomParams = z.object({
    projectId: z.integer(),
    roomId: z.uuid(),
  });

  listChatMessages = $action({
    method: "GET",
    path: "/projects/:projectId/chat/rooms/:roomId/messages",
    use: [this.ownsProject("chat:read")],
    description:
      "The latest messages of a room, newest first; pass `before` (a message id) for the page before it.",
    schema: {
      params: this.roomParams,
      query: z.object({
        before: z.uuid().optional(),
        limit: z.integer().min(1).max(100).optional(),
      }),
      response: z.object({
        items: z.array(chatMessageResourceSchema),
        hasMore: z.boolean(),
      }),
    },
    handler: async ({ params, query, user }) =>
      this.service.list(params.projectId, params.roomId, user!.id, query),
  });

  sendChatMessage = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/messages",
    use: [this.ownsProject("chat:write")],
    description:
      "Post a message in a room, as the caller. Markdown, `@handle` mentions and `#Q12` references; 4000 characters at most.",
    schema: {
      params: this.roomParams,
      body: z.object({ body: chatMessageBodySchema }),
      response: chatMessageResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      (
        await this.service.send(
          params.projectId,
          params.roomId,
          user!.id,
          body.body,
        )
      ).message,
  });

  editChatMessage = $action({
    method: "PATCH",
    path: "/projects/:projectId/chat/rooms/:roomId/messages/:messageId",
    use: [this.ownsProject("chat:write")],
    description: "Edit one of your own messages.",
    schema: {
      params: this.roomParams.extend({ messageId: z.uuid() }),
      body: z.object({ body: chatMessageBodySchema }),
      response: chatMessageResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      (
        await this.service.edit(
          params.projectId,
          params.roomId,
          params.messageId,
          user!.id,
          body.body,
        )
      ).message,
  });

  deleteChatMessage = $action({
    method: "DELETE",
    path: "/projects/:projectId/chat/rooms/:roomId/messages/:messageId",
    use: [this.ownsProject("chat:write")],
    description:
      "Delete a message: your own, or any with chat:manage. It keeps its place and loses its text.",
    schema: {
      params: this.roomParams.extend({ messageId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.service.remove(
        params.projectId,
        params.roomId,
        params.messageId,
        user!.id,
      );
      return { ok: true };
    },
  });

  markChatRoomRead = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/read",
    use: [this.ownsProject("chat:read")],
    description: "Mark a room read up to a message.",
    schema: {
      params: this.roomParams,
      body: z.object({ messageId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.service.markRead(
        params.projectId,
        params.roomId,
        user!.id,
        body.messageId,
      );
      return { ok: true };
    },
  });

  setChatRoomNotifyLevel = $action({
    method: "PUT",
    path: "/projects/:projectId/chat/rooms/:roomId/notify",
    use: [this.ownsProject("chat:write")],
    description:
      "Choose how a room reaches you: `mentions` (the default) or `muted`.",
    schema: {
      params: this.roomParams,
      body: z.object({ level: z.enum(["mentions", "muted"]) }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.service.setNotifyLevel(
        params.projectId,
        params.roomId,
        user!.id,
        body.level,
      );
      return { ok: true };
    },
  });

  getChatUnreadCounts = $action({
    method: "GET",
    path: "/projects/:projectId/chat/unread",
    use: [this.ownsProject("chat:read")],
    description:
      "Unread messages and unread mentions of the caller, for every room of the project they are in.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(
          z.object({
            roomId: z.uuid(),
            unread: z.integer(),
            mentions: z.integer(),
          }),
        ),
      }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.unreadCounts(params.projectId, user!.id),
    }),
  });
}
