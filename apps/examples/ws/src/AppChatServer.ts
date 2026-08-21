import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $websocket } from "alepha/websocket";

import { ChatChannels } from "./channels/ChatChannels.ts";

/**
 * Simple chat server - no database, just broadcasts messages
 */
export class AppChatServer {
  protected readonly log = $logger();
  protected readonly channels = $inject(ChatChannels);

  chat = $websocket({
    channel: this.channels.chatChannel,
    handler: async ({ connectionId, message, reply }) => {
      // Broadcast message to all clients in the room
      await reply({
        message: {
          username: connectionId.slice(0, 8),
          content: message.content,
          timestamp: Date.now(),
        },
      });
    },
    onConnect: ({ connectionId, roomIds }) => {
      this.log.info(
        `Client ${connectionId.slice(0, 8)} connected to rooms: ${roomIds.join(", ")}`,
      );
    },
    onDisconnect: ({ connectionId }) => {
      this.log.info(`Client ${connectionId.slice(0, 8)} disconnected`);
    },
  });
}
