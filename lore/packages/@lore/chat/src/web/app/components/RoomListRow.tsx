import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Ellipsis, Hash, Lock } from "lucide-react";
import type { KeyboardEvent, PointerEventHandler } from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import type { ChatRoomUnread } from "../services/roomOrder.ts";

/**
 * One entry of a row's "..." menu, worked by the page that owns the API.
 */
export interface RoomListRowAction {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface RoomListRowProps {
  room: ChatRoomResource;
  unread?: ChatRoomUnread;
  selected: boolean;
  onOpen: (room: ChatRoomResource) => void;
  /**
   * What the reader may do to the room from the list: archive, leave. No
   * menu when empty.
   */
  actions?: RoomListRowAction[];
  /**
   * A drag handle and a drop target, for whoever may order the list
   * (chat:manage), as a project icon on the dock is.
   */
  sortable?: boolean;
  /**
   * Held by the keyboard move: drawn as where a drop lands.
   */
  picked?: boolean;
  /**
   * The keyboard move: Space picks the room up, the arrows move it, Space or
   * Enter drops it, Escape puts it back.
   */
  onReorderKey?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /**
   * The id of the hint that explains the keyboard move.
   */
  describedBy?: string;
}

/**
 * One room of the Chat page's list (#E161, #Q3929), on one line: lock or
 * `#`, the name, the unread count (`@n` when some of it mentions the
 * reader), and a "..." menu shown on hover and on the open room, as a
 * sidebar menu item's action. The newest message's line and time are not
 * repeated here: the conversation beside it shows them.
 */
const RoomListRow = (props: RoomListRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { room } = props;
  const unread = props.unread?.unread ?? 0;
  const mentions = props.unread?.mentions ?? 0;
  const actions = props.actions ?? [];
  const sortable = !!props.sortable;
  const {
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: room.id, disabled: !sortable });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: room.id,
    disabled: !sortable,
  });

  return (
    <li
      // The dock's pattern (`ProjectRailItem`): the row carries dnd-kit's
      // refs and only its pointer listener, in the capture phase so the
      // menu trigger inside cannot swallow the press. The keyboard move is
      // the list's own, on the button.
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      onPointerDownCapture={
        sortable
          ? (listeners?.onPointerDown as
              | PointerEventHandler<HTMLLIElement>
              | undefined)
          : undefined
      }
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        "group/room relative rounded-md",
        sortable && "touch-none",
        // Where a drop lands, and what the keyboard holds.
        ((isOver && !isDragging) || props.picked) && "ring-primary ring-2",
        // Opaque while dragged: the row it passes over must not show through.
        isDragging && "bg-card cursor-grabbing shadow-lg",
      )}
    >
      <button
        type="button"
        data-testid="chat-room-row"
        data-room={room.name}
        aria-current={props.selected ? "page" : undefined}
        aria-describedby={sortable ? props.describedBy : undefined}
        onClick={() => props.onOpen(room)}
        onKeyDown={sortable ? props.onReorderKey : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left",
          // Room for the "..." at the end, so the name never runs under it.
          actions.length > 0 && "pe-8",
          // Washes of the text colour, never a surface token: the open room
          // on `--hover` (10%), a hovered one on `--hover-weak` (5%). A wash
          // moves away from whatever it sits on, in light, dark and every
          // theme; `accent` equals the list's `muted` in dark and vanished,
          // `background` made a black hole.
          props.selected
            ? "bg-hover text-foreground font-medium"
            : "hover:bg-hover-weak",
        )}
      >
        {/* Every room is a `#`; a private one adds a small lock after its
            name, explained on hover. */}
        <Hash className="text-muted-foreground size-3.5 shrink-0" />
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            unread > 0 && "font-semibold",
            room.archivedAt && "text-muted-foreground",
          )}
        >
          {room.name}
        </span>
        {room.private && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="text-muted-foreground flex shrink-0"
                  aria-label={tr("chat.room.private")}
                  data-testid="chat-room-private"
                />
              }
            >
              <Lock className="size-3" />
            </TooltipTrigger>
            <TooltipContent>{tr("chat.room.private")}</TooltipContent>
          </Tooltip>
        )}
        <span className="flex-1" />
        {unread > 0 && (
          <Badge
            {...(mentions > 0 ? { variant: "tint", tone: "red" } : {})}
            aria-label={tr("chat.rooms.unread", { args: [String(unread)] })}
          >
            {mentions > 0 ? `@${mentions}` : unread}
          </Badge>
        )}
      </button>
      {actions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="minimal"
                size="icon-xs"
                aria-label={tr("chat.rooms.actions", { args: [room.name] })}
                data-testid="chat-room-actions"
                className={cn(
                  "absolute end-1 top-1/2 -translate-y-1/2",
                  // Shown on the open room, on hover, on focus and while its
                  // menu is open; hidden otherwise, as a sidebar item's.
                  !props.selected &&
                    "group-hover/room:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 md:opacity-0",
                )}
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.key}
                variant={action.destructive ? "destructive" : "default"}
                disabled={action.disabled}
                onClick={action.onSelect}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
};

export default RoomListRow;
