import { t } from "alepha";
import { $channel } from "alepha/websocket";

export const chatInSchema = t.object({
  username: t.text(),
  content: t.text(),
  timestamp: t.integer(),
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
      out: t.object({
        content: t.text(),
      }),
    },
  });
}
