import { $atom, z } from "alepha";

export type QuestsView = "list" | "kanban";

/**
 * Which surface the Quests page shows — the grouped table or the kanban
 * board. Two components need the answer and they do not nest: the page
 * renders the surface, `ProjectView` drops the quest log and goes full
 * width under the board, and `ProjectActionsCreateButton` keeps the header
 * on the board after creating a quest.
 *
 * This used to live in `?view=kanban`, with `localStorage` seeding the URL
 * on a bare `/p/:id/`. The URL was chosen because plain `localStorage` is
 * invisible to `ProjectView`; an atom answers that objection directly, and
 * removes the seeding effect that made the choice a trap (#156). That
 * effect pushed a `replace` navigation back to the board whenever it found
 * no `view` param, and `useRouterState` is a global store — so on the way
 * OUT of the page the outgoing render saw the new route's empty query and
 * bounced the user straight back. Every sidebar link was dead for as long
 * as the board was the stored view. No guard fixes that while the view
 * lives in the URL, because the page cannot tell "nobody has chosen yet"
 * from "we are leaving"; moving the state out of the URL removes the
 * question instead of answering it.
 *
 * `persist: "cookie"` rather than `"localStorage"`: `ProjectView` picks the
 * layout during SSR, on first paint, and web storage does not exist there —
 * a localStorage-backed atom is empty on the server, so a returning kanban
 * user would get one frame of list layout before it swapped, and every
 * server boot would log the "persistence unavailable in this environment"
 * warning. Cookie persistence is SSR-safe by design and costs nothing here:
 * the value is a two-state UI preference, never trust-bearing.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const questsViewAtom = $atom({
  name: "lor.quests.view",
  schema: z.object({
    view: z.enum(["list", "kanban"]),
  }),
  default: { view: "list" as QuestsView },
  persist: "cookie",
});
