import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { chatRoomMemberResourceSchema } from "../schemas/chatRoomMemberResourceSchema.ts";
import { chatRoomNameSchema } from "../schemas/chatRoomNameSchema.ts";
import { chatRoomResourceSchema } from "../schemas/chatRoomResourceSchema.ts";
import { ChatRoomService } from "../services/ChatRoomService.ts";

/**
 * The rooms of a project's chat (#E161, #Q3925). Every action is gated on
 * the `chat` capability and a `chat:*` permission, then on the room's own
 * rule in {@link ChatRoomService}: a private room is a 404 for anyone
 * outside it.
 */
export class ChatRoomController {
  protected readonly service = $inject(ChatRoomService);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId", capability: "chat" });

  protected readonly roomParams = z.object({
    projectId: z.integer(),
    roomId: z.uuid(),
  });

  listChatRooms = $action({
    method: "GET",
    path: "/projects/:projectId/chat/rooms",
    use: [this.ownsProject("chat:read")],
    description:
      "The rooms of a project the caller can see: every open room, and the private rooms they are a member of.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(chatRoomResourceSchema) }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.visibleRooms(params.projectId, user!.id),
    }),
  });

  getChatRoom = $action({
    method: "GET",
    path: "/projects/:projectId/chat/rooms/:roomId",
    use: [this.ownsProject("chat:read")],
    description: "One room, if the caller can see it.",
    schema: { params: this.roomParams, response: chatRoomResourceSchema },
    handler: async ({ params, user }) =>
      this.service.resource(
        await this.service.visibleRoom(
          params.projectId,
          params.roomId,
          user!.id,
        ),
        user!.id,
      ),
  });

  createChatRoom = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms",
    use: [this.ownsProject("chat:write")],
    description:
      "Create a room, open to every project member or private to its members. The creator is its first member.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        name: chatRoomNameSchema,
        private: z.boolean().default(false),
      }),
      response: chatRoomResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.service.resource(
        await this.service.create(params.projectId, user!.id, body),
        user!.id,
      ),
  });

  renameChatRoom = $action({
    method: "PATCH",
    path: "/projects/:projectId/chat/rooms/:roomId",
    use: [this.ownsProject("chat:write")],
    description: "Rename a room: its creator, or chat:manage.",
    schema: {
      params: this.roomParams,
      body: z.object({ name: chatRoomNameSchema }),
      response: chatRoomResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.service.resource(
        await this.service.rename(
          params.projectId,
          params.roomId,
          user!.id,
          body.name,
        ),
        user!.id,
      ),
  });

  reorderChatRooms = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/order",
    use: [this.ownsProject("chat:manage")],
    description:
      "Set the order of the project's room list, for everyone: the rooms in the order given. chat:manage.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ roomIds: z.array(z.uuid()).max(500) }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.service.reorder(params.projectId, user!.id, body.roomIds);
      return { ok: true };
    },
  });

  archiveChatRoom = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/archive",
    use: [this.ownsProject("chat:write")],
    description:
      "Archive a room: it stays readable and refuses new messages. Its creator, or chat:manage.",
    schema: { params: this.roomParams, response: chatRoomResourceSchema },
    handler: async ({ params, user }) =>
      this.service.resource(
        await this.service.setArchived(
          params.projectId,
          params.roomId,
          user!.id,
          true,
        ),
        user!.id,
      ),
  });

  unarchiveChatRoom = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/unarchive",
    use: [this.ownsProject("chat:write")],
    description: "Bring an archived room back. Its creator, or chat:manage.",
    schema: { params: this.roomParams, response: chatRoomResourceSchema },
    handler: async ({ params, user }) =>
      this.service.resource(
        await this.service.setArchived(
          params.projectId,
          params.roomId,
          user!.id,
          false,
        ),
        user!.id,
      ),
  });

  joinChatRoom = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/join",
    use: [this.ownsProject("chat:write")],
    description: "Join an open room.",
    schema: { params: this.roomParams, response: chatRoomResourceSchema },
    handler: async ({ params, user }) =>
      this.service.resource(
        await this.service.join(params.projectId, params.roomId, user!.id),
        user!.id,
      ),
  });

  leaveChatRoom = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/leave",
    use: [this.ownsProject("chat:read")],
    description:
      "Leave a room. Leaving a private room loses access to it until someone invites you back.",
    schema: { params: this.roomParams, response: okSchema },
    handler: async ({ params, user }) => {
      await this.service.leave(params.projectId, params.roomId, user!.id);
      return { ok: true };
    },
  });

  listChatRoomMembers = $action({
    method: "GET",
    path: "/projects/:projectId/chat/rooms/:roomId/members",
    use: [this.ownsProject("chat:read")],
    description: "The members of a room the caller can see.",
    schema: {
      params: this.roomParams,
      response: z.object({ items: z.array(chatRoomMemberResourceSchema) }),
    },
    handler: async ({ params, user }) => ({
      items: await this.service.membersOf(
        params.projectId,
        params.roomId,
        user!.id,
      ),
    }),
  });

  inviteChatRoomMember = $action({
    method: "POST",
    path: "/projects/:projectId/chat/rooms/:roomId/members",
    use: [this.ownsProject("chat:write")],
    description:
      "Invite a project member into a private room the caller is in.",
    schema: {
      params: this.roomParams,
      body: z.object({ userId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.service.invite(
        params.projectId,
        params.roomId,
        user!.id,
        body.userId,
      );
      return { ok: true };
    },
  });

  removeChatRoomMember = $action({
    method: "DELETE",
    path: "/projects/:projectId/chat/rooms/:roomId/members/:userId",
    use: [this.ownsProject("chat:write")],
    description:
      "Remove a member from a private room: its creator, or chat:manage.",
    schema: {
      params: this.roomParams.extend({ userId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.service.remove(
        params.projectId,
        params.roomId,
        user!.id,
        params.userId,
      );
      return { ok: true };
    },
  });
}
