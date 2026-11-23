import { $ownsProject } from "@lore/core/api";
import { $inject, Alepha, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { chatMessageBodySchema } from "../schemas/chatMessageBodySchema.ts";
import { chatMessageResourceSchema } from "../schemas/chatMessageResourceSchema.ts";
import { chatReactionSchema } from "../schemas/chatReactionSchema.ts";
import { ChatAgentRunner } from "../services/ChatAgentRunner.ts";
import { ChatBuckets } from "../services/ChatBuckets.ts";
import { ChatMessageService } from "../services/ChatMessageService.ts";

/**
 * The messages of a room (#E161, #Q3926). Gated on the `chat` capability and
 * a `chat:*` permission, then on the room's own privacy rule.
 */
export class ChatMessageController {
  protected readonly service = $inject(ChatMessageService);
  protected readonly alepha = $inject(Alepha);

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
      "Post a message in a room, as the caller. Markdown, `@handle` mentions and `#Q12` references; 4000 characters at most. `attachments` are file ids from `uploadChatAttachment`, 10 at most; a message with files may have no text.",
    schema: {
      params: this.roomParams,
      body: z.object({
        body: chatMessageBodySchema.optional(),
        attachments: z.array(z.uuid()).max(10).optional(),
      }),
      response: chatMessageResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      (
        await this.service.send(
          params.projectId,
          params.roomId,
          user!.id,
          body.body ?? "",
          body.attachments ?? [],
          user,
        )
      ).message,
  });

  uploadChatAttachment = $action({
    method: "POST",
    path: "/projects/:projectId/chat/attachments",
    use: [this.ownsProject("chat:write")],
    description:
      "Upload a file to attach to the next message you send, 10 MB at most. Pass its id in `sendChatMessage`'s `attachments`.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      // The bucket's own cap: without it the framework's 5 MB default for a
      // multipart file refused anything between 5 and 10 MB.
      body: z.object({
        file: z.file({ maxBytes: ChatBuckets.MAX_SIZE_MB * 1024 * 1024 }),
      }),
      response: z.object({
        id: z.uuid(),
        name: z.text(),
        mimeType: z.text(),
        size: z.number(),
        url: z.text(),
      }),
    },
    handler: async ({ body, user }) => {
      // Resolved here, not held as a field: a controller stays pure.
      const file = await this.alepha
        .inject(ChatBuckets)
        .attachments.upload(body.file, { user });
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        url: `/api/files/${file.id}`,
      };
    },
  });

  decideChatAgentCall = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/messages/:messageId/decision",
    use: [this.ownsProject("chat:write")],
    description:
      "Approve or deny the write an agent's answer is waiting on. Only the member who mentioned the agent decides.",
    schema: {
      params: this.roomParams.extend({ messageId: z.uuid() }),
      body: z.object({ decision: z.enum(["approve", "deny"]) }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.alepha
        .inject(ChatAgentRunner)
        .decide(
          params.projectId,
          params.roomId,
          params.messageId,
          user!,
          body.decision,
        );
      return { ok: true };
    },
  });

  toggleChatReaction = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/messages/:messageId/reactions",
    use: [this.ownsProject("chat:write")],
    description:
      "Add your emoji under a message, or take it back if it is already there.",
    schema: {
      params: this.roomParams.extend({ messageId: z.uuid() }),
      body: z.object({ emoji: chatReactionSchema }),
      response: chatMessageResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.service.toggleReaction(
        params.projectId,
        params.roomId,
        params.messageId,
        user!.id,
        body.emoji,
      ),
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
            /**
             * A muted room still counts in its own row, never in the
             * sidebar's total.
             */
            notifyLevel: z.enum(["mentions", "muted"]),
          }),
        ),
      }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.unreadCounts(params.projectId, user!.id),
    }),
  });
}
