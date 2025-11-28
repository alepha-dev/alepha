import { $logger } from "alepha/logger";
import { $channel, $websocket } from "alepha/websocket";
import {
  CHAT_CHANNEL_PATH,
  chatInSchema,
  chatOutSchema,
} from "./chatChannel.ts";

/**
 * Simple chat server - no database, just broadcasts messages
 */
export class ChatServer {
  protected readonly log = $logger();

  chatChannel = $channel({
    path: CHAT_CHANNEL_PATH,
    description: "Simple chat channel",
    schema: {
      in: chatInSchema,
      out: chatOutSchema,
    },
  });

  chat = $websocket({
    channel: this.chatChannel,
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
