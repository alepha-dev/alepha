import { $channel } from "alepha/websocket";
import {
  CHAT_CHANNEL_PATH,
  chatInSchema,
  chatOutSchema,
} from "./chatChannel.ts";

/**
 * Chat client - browser side channel definition
 */
export class ChatClient {
  chatChannel = $channel({
    path: CHAT_CHANNEL_PATH,
    description: "Simple chat channel",
    schema: {
      in: chatInSchema,
      out: chatOutSchema,
    },
  });
}
