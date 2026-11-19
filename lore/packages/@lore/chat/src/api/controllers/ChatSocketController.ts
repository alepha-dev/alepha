import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $websocket } from "alepha/websocket";

import { ChatChannels } from "../../schemas/ChatChannels.ts";

/**
 * The chat socket (#E161, decided by the spike #Q3923, folio #F1528).
 *
 * ## One socket per member, the server picks the recipients
 *
 * A signed-in page opens ONE socket, `/ws/chat?roomId=<its own user id>`:
 * `$secure` says who it is, `canJoin` refuses any other id. The framework's
 * "room" is therefore the member, not a chat room, and on Cloudflare it is
 * one Durable Object per member, hibernating while idle.
 *
 * Every frame is sent by the server with `emit({ roomIds })`, naming the
 * members allowed to see it at that moment, read from the database
 * ({@link ChatAudience}). So a private room's frame reaches its members
 * only, and a member removed from a room stops receiving at once on both
 * engines: they are no longer named, and nothing has to close a socket
 * (`closeConnection` is a no-op on Workers).
 *
 * ## A frame is a hint
 *
 * The database is the source of truth. A page refetches what it shows on
 * every (re)connection, and a frame it missed is simply not seen.
 *
 * No `$action` here: a `$websocket` acts at boot, so this class is listed in
 * the module's `services` and kept free of request handlers.
 */
export class ChatSocketController {
  public static readonly PATH = ChatChannels.PATH;

  protected readonly channels = $inject(ChatChannels);

  socket = $websocket({
    channel: this.channels.feed,
    use: [$secure()],
    canJoin: ({ userId, roomId }) => !!userId && roomId === userId,
    maxConnectionsPerUser: 20,
    handler: async () => {
      // Client frames carry nothing yet: "is typing" comes with #Q3940.
    },
  });
}
