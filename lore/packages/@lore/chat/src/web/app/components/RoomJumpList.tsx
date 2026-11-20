import {
  Button,
  cn,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, Hash, Lock } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";

export interface RoomJumpListProps {
  room: ChatRoomResource;
  /**
   * The rooms the reader can see, as the chat API listed them: a private
   * room of others is never in it.
   */
  rooms: ChatRoomResource[];
  onOpen: (room: ChatRoomResource) => void;
}

/**
 * The room name in the conversation header (#E161, #Q3955): it opens the
 * rooms the reader can see, filtered as they type. Not in the spotlight
 * search, whose sources never learn who is asking.
 */
const RoomJumpList = (props: RoomJumpListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const Icon = props.room.private ? Lock : Hash;

  const matches = props.rooms.filter((room) =>
    room.name.includes(filter.trim().toLowerCase()),
  );

  const go = (room: ChatRoomResource) => {
    setOpen(false);
    setFilter("");
    props.onOpen(room);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        matches.length ? (index + step + matches.length) % matches.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const room = matches[active];
      if (room) go(room);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="minimal"
            className="min-w-0 gap-1.5 px-1.5"
            aria-label={tr("chat.room.jump", { args: [props.room.name] })}
            data-testid="chat-room-jump"
          />
        }
      >
        <Icon className="text-muted-foreground size-4" />
        <h1 className="truncate font-medium">{props.room.name}</h1>
        <ChevronDown className="text-muted-foreground size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input
          aria-label={tr("chat.room.jump.filter")}
          placeholder={tr("chat.room.jump.filter")}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          className="mt-2 max-h-72 overflow-y-auto"
          data-testid="chat-room-jump-list"
        >
          {matches.map((room, index) => (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => go(room)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm",
                  index === active ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {room.private ? (
                  <Lock className="text-muted-foreground size-3.5" />
                ) : (
                  <Hash className="text-muted-foreground size-3.5" />
                )}
                {room.name}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              {tr("chat.room.jump.none")}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

export default RoomJumpList;
