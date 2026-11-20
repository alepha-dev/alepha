import { Button, cn } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import {
  type ChatRoomFilter,
  type ChatRoomUnread,
  orderRooms,
} from "../services/roomOrder.ts";
import RoomListRow from "./RoomListRow.tsx";

export interface RoomListProps {
  rooms: ChatRoomResource[];
  unread: ReadonlyMap<string, ChatRoomUnread>;
  selectedId?: string;
  now: number;
  onOpen: (room: ChatRoomResource) => void;
  /**
   * The `+` above the list, when the reader may create a room.
   */
  onCreate?: () => void;
}

const FILTERS: ChatRoomFilter[] = ["all", "unread", "private"];

// Spelled out, so the i18n check finds every key it reads.
const FILTER_LABELS = {
  all: "chat.rooms.filter.all",
  unread: "chat.rooms.filter.unread",
  private: "chat.rooms.filter.private",
} as const;

const NONE_LABELS = {
  all: "chat.rooms.none.all",
  unread: "chat.rooms.none.unread",
  private: "chat.rooms.none.private",
} as const;

/**
 * The left column of the Chat page (#E161, #Q3929): one flat list, what
 * needs the reader first, quiet rooms folded behind one row.
 */
const RoomList = (props: RoomListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [filter, setFilter] = useState<ChatRoomFilter>("all");
  const [showQuiet, setShowQuiet] = useState(false);
  const { active, quiet } = orderRooms(props.rooms, props.unread, {
    filter,
    now: props.now,
    selectedId: props.selectedId,
  });

  return (
    <nav
      aria-label={tr("chat.rooms.label")}
      className="flex h-full min-h-0 flex-col px-2 pt-2.5"
      data-testid="chat-room-list"
    >
      <div className="flex items-center gap-1.5 px-1 pt-1 pb-2">
        <h2 className="flex-1 text-sm font-semibold">
          {tr("chat.rooms.label")}
        </h2>
        {props.onCreate && (
          <Button
            variant="minimal"
            size="icon-sm"
            aria-label={tr("chat.room.new.title")}
            data-testid="chat-new-room"
            onClick={props.onCreate}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 pb-2" role="tablist">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              filter === key
                ? "bg-foreground text-background border-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            {tr(FILTER_LABELS[key])}
          </button>
        ))}
      </div>
      <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2.5">
        {active.map((room) => (
          <RoomListRow
            key={room.id}
            room={room}
            unread={props.unread.get(room.id)}
            selected={room.id === props.selectedId}
            onOpen={props.onOpen}
          />
        ))}
        {active.length === 0 && quiet.length === 0 && (
          <li className="text-muted-foreground px-2 py-2.5 text-sm">
            {tr(NONE_LABELS[filter])}
          </li>
        )}
        {quiet.length > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={showQuiet}
              onClick={() => setShowQuiet((value) => !value)}
              className="text-muted-foreground hover:bg-accent/50 w-full rounded-md px-2 py-1.5 text-left text-xs"
            >
              {showQuiet
                ? tr("chat.rooms.quiet.hide")
                : tr("chat.rooms.quiet.show", { args: [String(quiet.length)] })}
            </button>
          </li>
        )}
        {showQuiet &&
          quiet.map((room) => (
            <RoomListRow
              key={room.id}
              room={room}
              unread={props.unread.get(room.id)}
              selected={room.id === props.selectedId}
              onOpen={props.onOpen}
            />
          ))}
      </ul>
    </nav>
  );
};

export default RoomList;
