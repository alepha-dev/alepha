import { useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useRoom } from "alepha/react/websocket";
import { useRef } from "react";

import { ChatChannels, type ChatServerFrame } from "../../../schemas/index.ts";

/**
 * The member's live chat feed (#E161): one socket per signed-in tab, its
 * room being the member's own user id, so the server can address every
 * frame to exactly the people allowed to see it.
 *
 * A frame is a hint. `onResync` runs on every reconnection after the first,
 * and the page refetches what it shows: whatever was sent while the socket
 * was down is read from the database, never replayed.
 *
 * It retries forever, backing off to 30 s, so a tab left open through an
 * outage comes back on its own.
 */
export const useChatFeed = (options: {
  onFrame: (frame: ChatServerFrame) => void;
  onResync: () => void;
}): { connected: boolean } => {
  const auth = useAuth();
  const channel = useInject(ChatChannels).feed;
  const userId = auth.user?.id;

  // Read at call time, so the subscription never needs to restart for a new
  // callback.
  const latest = useRef(options);
  latest.current = options;
  const connections = useRef(0);

  const room = useRoom(
    {
      roomId: userId ?? "",
      channel,
      handler: (frame) => latest.current.onFrame(frame),
      autoReconnect: true,
      reconnectInterval: 1000,
      maxReconnectInterval: 30_000,
      maxReconnectAttempts: -1,
      onConnect: () => {
        connections.current += 1;
        if (connections.current > 1) {
          latest.current.onResync();
        }
      },
    },
    [userId, channel],
  );

  return { connected: room.isConnected };
};
