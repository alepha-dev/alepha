import { z } from "alepha";
import { $channel } from "alepha/websocket";

import { chatClientFrameSchema } from "../api/schemas/chatClientFrameSchema.ts";
import { chatServerFrameSchema } from "../api/schemas/chatServerFrameSchema.ts";

/**
 * The chat socket's channel (#E161), declared once for both sides: the
 * server's `ChatSocketController` serves it, the Chat page subscribes to it.
 *
 * One socket per member: the `roomId` of the URL is the member's own user
 * id, and every frame names its project and chat room.
 */
export class ChatChannels {
  public static readonly PATH = "/ws/chat";

  feed = $channel({
    path: ChatChannels.PATH,
    description: "A member's live chat feed, across every project they are in",
    schema: {
      roomId: z.uuid(),
      in: chatServerFrameSchema,
      out: chatClientFrameSchema,
    },
  });
}
