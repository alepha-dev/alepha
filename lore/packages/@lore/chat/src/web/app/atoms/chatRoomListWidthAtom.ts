import { $atom, z } from "alepha";

/**
 * The Chat page's room list width, set by dragging its edge, as the quest
 * log's and the folio tree's are. A cookie, so the page server-renders at
 * the width the reader left it.
 */
export const chatRoomListWidthAtom = $atom({
  name: "lor.chat.room-list",
  schema: z.object({
    /**
     * In pixels. Absent means the default width.
     */
    width: z.integer().optional(),
  }),
  default: {},
  persist: "cookie",
});
