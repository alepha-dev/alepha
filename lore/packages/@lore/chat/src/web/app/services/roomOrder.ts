import type { ChatRoomResource } from "../../../schemas/index.ts";

/**
 * The room list's three filters (#Q3929). The mockup's People and Linked
 * filters are not V1.
 */
export type ChatRoomFilter = "all" | "unread" | "private";

export interface ChatRoomUnread {
  unread: number;
  mentions: number;
}

export interface OrderedRooms {
  /**
   * What the list shows, in the order a manager set by dragging, else oldest
   * room first: a room keeps its place whatever is said
   * in it, so a message sent or received never moves a row under the
   * pointer. Unread is shown on the row (bold, a count), not by its place.
   */
  active: ChatRoomResource[];
  /**
   * Folded behind "Show N quiet rooms": nothing unread and no activity for
   * {@link QUIET_AFTER_MS}, or archived.
   */
  quiet: ChatRoomResource[];
}

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * A week without a message makes a room quiet.
 */
export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * When a room last moved: its newest message, else its creation.
 */
export const lastActivityOf = (room: ChatRoomResource): string =>
  room.lastMessage?.createdAt ?? room.createdAt;

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * The room list of the Chat page, ordered and folded (#E161, #Q3929).
 *
 * One flat list, never a tree, in creation order: sorting by the last message
 * moved the open room to the top on every message sent. The room being
 * read is never folded, so opening a quiet room by its link does not make
 * it vanish from the list it is selected in.
 */
export const orderRooms = (
  rooms: ChatRoomResource[],
  unread: ReadonlyMap<string, ChatRoomUnread>,
  options: { filter: ChatRoomFilter; now: number; selectedId?: string },
): OrderedRooms => {
  const unreadOf = (room: ChatRoomResource) => unread.get(room.id)?.unread ?? 0;
  const kept = rooms.filter((room) => {
    if (options.filter === "unread") return unreadOf(room) > 0;
    if (options.filter === "private") return room.private;
    return true;
  });

  // The order someone set by dragging first, then the rooms never placed,
  // oldest first, the name breaking a tie: a new room joins the end.
  const sorted = [...kept].sort((a, b) => {
    const placed =
      Number(b.position !== undefined) - Number(a.position !== undefined);
    if (placed !== 0) return placed;
    if (a.position !== undefined && b.position !== undefined) {
      const byPosition = a.position - b.position;
      if (byPosition !== 0) return byPosition;
    }
    return (
      a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name)
    );
  });

  const isQuiet = (room: ChatRoomResource) =>
    room.id !== options.selectedId &&
    unreadOf(room) === 0 &&
    (!!room.archivedAt ||
      options.now - Date.parse(lastActivityOf(room)) > QUIET_AFTER_MS);

  return {
    active: sorted.filter((room) => !isQuiet(room)),
    quiet: sorted.filter(isQuiet),
  };
};
