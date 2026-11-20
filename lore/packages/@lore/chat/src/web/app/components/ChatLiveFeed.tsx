import {
  canInProject,
  currentProjectAtom,
  DOCK_UNREAD_KEY,
  hasCapability,
} from "@lore/core/web";
import { useInject, useQueryClient, useStore } from "alepha/react";
import { useEffect, useRef } from "react";

import { useChatFeed } from "../hooks/useChatFeed.ts";
import { ChatFeedHub } from "../services/ChatFeedHub.ts";
import { ChatUnread } from "../services/ChatUnread.ts";

/**
 * The member's chat socket, held once at the layout's root (#E161, #Q3940):
 * only inside a project with chat on that the reader reads, so a project
 * without chat opens no socket.
 */
const ChatLiveFeed = () => {
  const [project] = useStore(currentProjectAtom);
  const live =
    !!project &&
    hasCapability(project, "chat") &&
    canInProject(project, "chat:read");
  return live ? <ChatLiveConnection projectId={project.id} /> : null;
};

export interface ChatLiveConnectionProps {
  projectId: number;
}

/**
 * The socket itself: every frame goes to the hub, and one of this project
 * moves the badge.
 */
const ChatLiveConnection = (props: ChatLiveConnectionProps) => {
  const hub = useInject(ChatFeedHub);
  const unread = useInject(ChatUnread);
  const queries = useQueryClient();
  // A new message may be a mention of the reader, which lands in their inbox
  // a moment after the frame: the dock's badges read again then (#Q3981),
  // once for a burst of messages.
  const dockRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(dockRefresh.current), []);

  const feed = useChatFeed({
    onFrame: (frame) => {
      hub.publish(frame);
      if (frame.projectId === props.projectId && frame.type !== "typing") {
        unread.refresh(props.projectId);
      }
      if (frame.type === "message.created") {
        clearTimeout(dockRefresh.current);
        dockRefresh.current = setTimeout(
          () => queries.invalidate([DOCK_UNREAD_KEY]),
          1500,
        );
      }
    },
    onResync: () => {
      hub.resync();
      unread.refresh(props.projectId);
    },
  });

  useEffect(() => {
    hub.connect(feed.send);
    return () => hub.connect(undefined);
  }, [hub, feed.send]);

  return null;
};

export default ChatLiveFeed;
