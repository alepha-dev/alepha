import { Badge, cn, TimeAgo } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Bot, Hash, Lock } from "lucide-react";

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
  const Icon = room.personal ? Bot : room.private ? Lock : Hash;
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
          "flex w-full items-start gap-2 rounded-md p-2 text-left",
          props.selected ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon className="text-muted-foreground size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm",
              unread > 0 && "font-semibold",
              room.archivedAt && "text-muted-foreground",
            )}
          >
            {room.personal ? tr("chat.rooms.personal") : room.name}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {last
              ? last.deleted
                ? tr("chat.message.deleted")
                : last.preview
              : room.archivedAt
                ? tr("chat.rooms.archived")
                : tr("chat.rooms.empty")}
          </span>
        </span>
        {last && (
          <TimeAgo
            value={last.createdAt}
            className="text-muted-foreground shrink-0 text-[11px] leading-5"
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
      </button>
    </li>
  );
};

export default RoomListRow;
