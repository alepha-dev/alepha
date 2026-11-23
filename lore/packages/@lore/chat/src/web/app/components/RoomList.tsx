import { Button } from "@alepha/ui";
import { DndContext, useSortableList } from "@alepha/ui/sortable";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

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
  const hintId = useId();
  const [showQuiet, setShowQuiet] = useState(false);
  const { active, quiet } = orderRooms(props.rooms, props.unread, {
    filter: "all",
    now: props.now,
    selectedId: props.selectedId,
  });
  const sortable = !!props.onReorder;
  const byId = new Map(active.map((room) => [room.id, room]));
  // The shared sortable list (#Q4128): a drop or a keyboard step is drawn
  // at once and held until the rooms read back in their new order.
  const list = useSortableList<string>({
    ids: active.map((room) => room.id),
    labelOf: (id) => byId.get(id)?.name ?? "",
    // The whole list in its new order: the visible rooms as moved, then the
    // folded ones, which keep their places after them.
    onReorder: (next) =>
      props.onReorder?.([...next, ...quiet.map((room) => room.id)]),
    announcements: {
      picked: (name) => tr("dock.reorder.picked", { args: [name] }),
      moved: (name, at, total) =>
        tr("dock.reorder.moved", { args: [name, String(at), String(total)] }),
      dropped: (name) => tr("dock.reorder.dropped", { args: [name] }),
      cancelled: (name) => tr("dock.reorder.cancelled", { args: [name] }),
    },
  });
  const shown = list.order
    .map((id) => byId.get(id))
    .filter((room) => room !== undefined);

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
            {list.announcement}
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
      <DndContext {...list.contextProps}>
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-2">
          {shown.map((room) => (
            <RoomListRow
              key={room.id}
              room={room}
              unread={props.unread.get(room.id)}
              selected={room.id === props.selectedId}
              onOpen={props.onOpen}
              actions={props.actionsFor?.(room)}
              sortable={sortable}
              picked={list.picked === room.id}
              onReorderKey={list.onKeyDown(room.id)}
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
