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
   * What the list shows: rooms with something unread first, then by last
   * activity, newest first.
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
 * One flat list, never a tree: what needs the reader comes first. The room
 * being read is never folded, so opening a quiet room by its link does not
 * make it vanish from the list it is selected in.
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

  const sorted = [...kept].sort((a, b) => {
    const byUnread = Number(unreadOf(b) > 0) - Number(unreadOf(a) > 0);
    if (byUnread !== 0) return byUnread;
    const byActivity = lastActivityOf(b).localeCompare(lastActivityOf(a));
    if (byActivity !== 0) return byActivity;
    return a.name.localeCompare(b.name);
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
