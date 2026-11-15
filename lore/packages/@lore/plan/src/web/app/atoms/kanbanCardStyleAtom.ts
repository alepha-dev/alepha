import { $atom, z } from "alepha";

/**
 * How the board draws its cards: `compact` (one line per fact, the
 * default) or `clean` (the title on up to two lines, priority as the card's
 * left edge, details in a quiet footer).
 *
 * A per-person preference, not a project setting: two people reading the
 * same board want different densities, and neither choice changes what the
 * board says.
 *
 * `persist: "cookie"` rather than `localStorage`, for the reason
 * `kanbanFiltersAtom` gives: the board renders during SSR, where web storage
 * does not exist, so a localStorage-backed atom would draw the wrong cards
 * for one frame on every load.
 */
export const kanbanCardStyleAtom = $atom({
  name: "lor.kanban.card-style",
  schema: z.object({
    style: z.enum(["clean", "compact"]),
  }),
  default: { style: "compact" as const },
  persist: "cookie",
});
