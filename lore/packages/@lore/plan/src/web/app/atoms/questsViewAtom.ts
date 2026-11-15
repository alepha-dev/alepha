import { $atom, z } from "alepha";

/**
 * Which view `/quests` shows: the List (the quests table) or the Board.
 *
 * One URL for both, the tabs swapping the body in place, and the choice
 * remembered per person, like the board's filters and card style. It was
 * two routes (`/quests` and `/quests/board`) before.
 *
 * ⚠️ Never in the URL. A `?view=` param with a write-back is what made every
 * sidebar link dead (#156): an effect restoring it saw the next route's empty
 * query on the way out and bounced the reader back. A cookie is read on
 * render and written only by a click on the tabs, so there is no write-back
 * to misfire.
 *
 * `persist: "cookie"` rather than `localStorage`: the page renders during
 * SSR, where web storage does not exist, so a localStorage-backed atom would
 * draw the List for one frame before the Board on every load.
 */
export const questsViewAtom = $atom({
  name: "lor.quests.view",
  schema: z.object({
    view: z.enum(["list", "board"]),
  }),
  default: { view: "list" as const },
  persist: "cookie",
});
