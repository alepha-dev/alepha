import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { ChatSocketController } from "../controllers/ChatSocketController.ts";
import type { ChatServerFrame } from "../schemas/chatServerFrameSchema.ts";

/**
 * Sends a frame to members' sockets (#E161). One member is one socket room
 * (see {@link ChatSocketController}), so a frame for a chat room is sent to
 * the list of members allowed to see it.
 *
 * Best effort: a frame is a hint and the write it describes is already in
 * the database, so a failed send is logged and never fails the write.
 */
export class ChatLive {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();

  public async send(userIds: string[], frame: ChatServerFrame): Promise<void> {
    const roomIds = [...new Set(userIds)];
    if (roomIds.length === 0) {
      return;
    }
    try {
      await this.alepha
        .inject(ChatSocketController)
        .socket.emit({ roomIds, message: frame });
    } catch (error) {
      this.log.warn("A chat frame was not sent; readers refetch on reconnect", {
        type: frame.type,
        recipients: roomIds.length,
        error,
      });
    }
  }
}
