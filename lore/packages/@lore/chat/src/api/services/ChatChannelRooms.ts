import { ChannelRoomRegistry } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";

import { chatMessages } from "../entities/chatMessages.ts";
import { chatRooms } from "../entities/chatRooms.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatMessageService } from "./ChatMessageService.ts";

/**
 * Chat's half of room channels (#Q4052): a notification channel may post
 * into an open, unarchived room of its project, as Lore. Registered on
 * core's {@link ChannelRoomRegistry}, since core may not import Chat.
 *
 * A private room is never offered nor posted into: a manager may not be in
 * it, and the channel would tell its members whatever they subscribed it to.
 */
export class ChatChannelRooms {
  protected readonly alepha = $inject(Alepha);
  protected readonly registry = $inject(ChannelRoomRegistry);
  protected readonly rooms = $repository(chatRooms);
  protected readonly messages = $repository(chatMessages);

  constructor() {
    this.registry.register({
      rooms: (projectId) => this.open(projectId),
      post: (projectId, roomId, body) => this.post(projectId, roomId, body),
    });
  }

  protected async open(projectId: number) {
    const rows = await this.rooms.findMany({
      where: {
        projectId: { eq: projectId },
        private: { eq: false },
        archivedAt: { isNull: true },
      },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 200,
    });
    return rows.map((room) => ({ id: room.id, name: room.name }));
  }

  protected async post(
    projectId: number,
    roomId: string,
    body: string,
  ): Promise<boolean> {
    const room = await this.rooms.findOne({
      where: { id: { eq: roomId }, projectId: { eq: projectId } },
    });
    if (!room || room.private || room.archivedAt) return false;
    const message = await this.messages.create({
      roomId: room.id,
      agent: "lore",
      body,
    });
    // Shown live to whoever sees the room, as a member's message is.
    const [resource] = await this.alepha
      .inject(ChatMessageService)
      .decorate([message]);
    await this.alepha
      .inject(ChatLive)
      .send(await this.alepha.inject(ChatAudience).of(room), {
        type: "message.created",
        projectId,
        roomId: room.id,
        message: resource!,
      });
    return true;
  }
}
