import { z } from "alepha";
import { $channel } from "alepha/websocket";

export const chatInSchema = z.object({
  username: z.text(),
  content: z.text(),
  timestamp: z.integer(),
});

/**
 * Channels for chat application
 */
export class ChatChannels {
  chatChannel = $channel({
    path: "/ws/chat",
    description: "Simple chat channel",
    schema: {
      in: chatInSchema,
      out: z.object({
        content: z.text(),
      }),
    },
  });
}
