import { Button } from "@alepha/ui";
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import { type ChatRoomUnread, orderRooms } from "../services/roomOrder.ts";
import RoomListRow, { type RoomListRowAction } from "./RoomListRow.tsx";

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
  /**
   * A row's "..." menu: what the reader may do to that room from the list.
   */
  actionsFor?: (room: ChatRoomResource) => RoomListRowAction[];
  /**
   * Given to whoever may order the list for everyone (chat:manage): the
   * rooms are dragged, or moved from the keyboard, and the new order is
   * saved with this.
   */
  onReorder?: (roomIds: string[]) => void;
}

/**
 * The left column of the Chat page (#E161, #Q3929): one flat list in the
 * order a manager set, quiet rooms folded behind one row.
 *
 * Reordered the way the project dock is (`ProjectRail`): drag a room onto
 * another, or Space to pick it up, the arrows to move it, Space or Enter to
 * drop it and Escape to put it back. Drawn at once, saved on the drop.
 */
const RoomList = (props: RoomListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dndId = useId();
  const hintId = useId();
  const [showQuiet, setShowQuiet] = useState(false);
  // The order being shown before the server has it: set on a drop (or each
  // keyboard step), dropped once the rooms read back in that order.
  const [pending, setPending] = useState<string[] | undefined>();
  const [picked, setPicked] = useState<
    { id: string; before: string[] } | undefined
  >();
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    // Without a distance a plain click would start a drag, and a click on a
    // room must stay a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // The server's list has caught up with the order shown: hand back to it,
  // during render (React's "adjust state when a prop changes"), so the
  // held order never outlives the save, and no effect runs a second pass.
  if (
    pending &&
    pending.every(
      (id, at) =>
        props.rooms.find((room) => room.id === id)?.position === at ||
        !props.rooms.some((room) => room.id === id),
    )
  ) {
    setPending(undefined);
  }
  const shown = pending;
  const rooms = shown
    ? props.rooms.map((room) => {
        const at = shown.indexOf(room.id);
        return at < 0 ? room : { ...room, position: at };
      })
    : props.rooms;
  const { active, quiet } = orderRooms(rooms, props.unread, {
    filter: "all",
    now: props.now,
    selectedId: props.selectedId,
  });
  const sortable = !!props.onReorder;
  const ids = active.map((room) => room.id);
  const nameOf = (id: string) =>
    props.rooms.find((room) => room.id === id)?.name ?? "";

  // The whole list in its new order: the visible rooms as moved, then the
  // folded ones, which keep their places after them.
  const save = (next: string[]) => {
    const full = [...next, ...quiet.map((room) => room.id)];
    setPending(full);
    props.onReorder?.(full);
  };

  // One column: a row moves up and down it, never sideways, never past its
  // ends (the dock's `vertical` modifier).
  const vertical: Modifier = ({
    transform,
    draggingNodeRect,
    containerNodeRect,
  }) => {
    let y = transform.y;
    if (draggingNodeRect && containerNodeRect) {
      y = Math.min(
        Math.max(y, containerNodeRect.top - draggingNodeRect.top),
        containerNodeRect.bottom - draggingNodeRect.bottom,
      );
    }
    return { ...transform, x: 0, y };
  };

  const onDragEnd = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    save(next);
  };

  const onReorderKey =
    (id: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
      const held = picked?.id === id;
      if (event.key === " ") {
        event.preventDefault();
        if (!held) {
          setPicked({ id, before: ids });
          setAnnouncement(tr("dock.reorder.picked", { args: [nameOf(id)] }));
          return;
        }
      }
      if (!held) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const from = ids.indexOf(id);
        const to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= ids.length) return;
        const next = [...ids];
        next.splice(to, 0, ...next.splice(from, 1));
        // Drawn now, saved on the drop.
        setPending([...next, ...quiet.map((room) => room.id)]);
        setAnnouncement(
          tr("dock.reorder.moved", {
            args: [nameOf(id), String(to + 1), String(ids.length)],
          }),
        );
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setPicked(undefined);
        setAnnouncement(tr("dock.reorder.dropped", { args: [nameOf(id)] }));
        if (ids.join(",") !== picked.before.join(",")) save(ids);
        return;
      }
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        setPending(undefined);
        setPicked(undefined);
        setAnnouncement(tr("dock.reorder.cancelled", { args: [nameOf(id)] }));
      }
    };

  return (
    <nav
      aria-label={tr("chat.rooms.label")}
      // Chrome, as a DataTable's preset rail is (`bg-muted` under the
      // `--bevel` line): the list frames the conversation, which is content.
      className="chrome flex h-full min-h-0 flex-col"
      data-testid="chat-room-list"
    >
      {sortable && (
        <>
          <span id={hintId} className="sr-only">
            {tr("chat.rooms.reorder.hint")}
          </span>
          <span aria-live="assertive" className="sr-only">
            {announcement}
          </span>
        </>
      )}
      {/* The conversation header's twin: 46px and a bottom rule, so the two
          bands line up across the page. */}
      <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b pr-2 pl-3">
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
      <DndContext
        id={dndId}
        sensors={sensors}
        modifiers={[vertical]}
        autoScroll={{ threshold: { x: 0, y: 0.2 } }}
        onDragEnd={onDragEnd}
      >
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-2">
          {active.map((room) => (
            <RoomListRow
              key={room.id}
              room={room}
              unread={props.unread.get(room.id)}
              selected={room.id === props.selectedId}
              onOpen={props.onOpen}
              actions={props.actionsFor?.(room)}
              sortable={sortable}
              picked={picked?.id === room.id}
              onReorderKey={onReorderKey(room.id)}
              describedBy={hintId}
            />
          ))}
          {active.length === 0 && quiet.length === 0 && (
            <li className="text-muted-foreground px-2 py-2.5 text-sm">
              {tr("chat.rooms.none.all")}
            </li>
          )}
          {quiet.length > 0 && (
            <li>
              <button
                type="button"
                aria-expanded={showQuiet}
                onClick={() => setShowQuiet((value) => !value)}
                className="text-muted-foreground hover:bg-hover-weak w-full rounded-md px-2 py-1.5 text-left text-xs"
              >
                {showQuiet
                  ? tr("chat.rooms.quiet.hide")
                  : tr("chat.rooms.quiet.show", {
                      args: [String(quiet.length)],
                    })}
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
                actions={props.actionsFor?.(room)}
              />
            ))}
        </ul>
      </DndContext>
    </nav>
  );
};

export default RoomList;
