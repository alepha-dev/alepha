import { FileAccessRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { chatAgents } from "../entities/chatAgents.ts";
import { chatMessages } from "../entities/chatMessages.ts";
import { ChatBuckets } from "./ChatBuckets.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * Who reads a chat message's file (#E161, #Q3939): whoever reads the room.
 *
 * An open room is the project's: a rank with `chat:read` there. A private
 * room is its members': a non-member is answered 404 whatever their rank,
 * as the room itself is to them. Thrown here rather than returned, since an
 * empty answer is core's 403, which would confirm the file exists.
 */
export class ChatFileAccess {
  protected readonly messages = $repository(chatMessages);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly agents = $repository(chatAgents);

  constructor() {
    // An agent's picture (#E170): whoever reads the project's chat, a
    // deleted agent's too, since its past answers still show it.
    $inject(FileAccessRegistry).register(
      ChatBuckets.AGENT_AVATAR_BUCKET,
      async (fileId) => {
        const agent = await this.agents.findOne({
          where: { avatar: { eq: fileId } },
        });
        return agent
          ? { projectId: agent.projectId, permission: "chat:read" }
          : undefined;
      },
    );
    $inject(FileAccessRegistry).register(
      ChatBuckets.ATTACHMENT_BUCKET,
      async (fileId, reader) => {
        // The message that lists the file in its `attachments` JSON array.
        const message = await this.messages.findOne({
          where: { attachments: { like: `%"${fileId}"%` } },
        });
        if (!message) return undefined;
        const room = await this.rooms.roomById(message.roomId);
        if (!room) return undefined;
        if (
          room.private &&
          !(await this.rooms.membershipOf(room.id, reader.id))
        ) {
          throw new NotFoundError("File not found");
        }
        return { projectId: room.projectId, permission: "chat:read" };
      },
    );
  }
}
