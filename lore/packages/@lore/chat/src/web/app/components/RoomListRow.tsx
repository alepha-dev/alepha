import { Badge, cn, TimeAgo } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Hash, Lock } from "lucide-react";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import type { ChatRoomUnread } from "../services/roomOrder.ts";

export interface RoomListRowProps {
  room: ChatRoomResource;
  unread?: ChatRoomUnread;
  selected: boolean;
  onOpen: (room: ChatRoomResource) => void;
}

/**
 * One room of the Chat page's list (#E161, #Q3929): lock or `#`, the name,
 * the newest message's time and first line, the unread count, `@n` when
 * some of it mentions the reader.
 */
const RoomListRow = (props: RoomListRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { room } = props;
  const unread = props.unread?.unread ?? 0;
  const mentions = props.unread?.mentions ?? 0;
  const Icon = room.private ? Lock : Hash;
  const last = room.lastMessage;

  return (
    <li>
      <button
        type="button"
        data-testid="chat-room-row"
        data-room={room.name}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => props.onOpen(room)}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left",
          props.selected ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span className="flex items-center gap-1.5">
          <Icon className="text-muted-foreground size-3.5 shrink-0" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              unread > 0 && "font-semibold",
              room.archivedAt && "text-muted-foreground",
            )}
          >
            {room.name}
          </span>
          {last && (
            <TimeAgo
              value={last.createdAt}
              className="text-muted-foreground shrink-0 text-xs"
            />
          )}
          {unread > 0 && (
            <Badge
              {...(mentions > 0 ? { variant: "tint", tone: "red" } : {})}
              aria-label={tr("chat.rooms.unread", { args: [String(unread)] })}
            >
              {mentions > 0 ? `@${mentions}` : unread}
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground truncate pl-5 text-xs">
          {last
            ? last.deleted
              ? tr("chat.message.deleted")
              : last.preview
            : room.archivedAt
              ? tr("chat.rooms.archived")
              : tr("chat.rooms.empty")}
        </span>
      </button>
    </li>
  );
};

export default RoomListRow;
