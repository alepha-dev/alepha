import { $atom, z } from "alepha";

/**
 * Whether the Quest Log pane is collapsed to its rail.
 *
 * It was deliberately kept out of `questsViewAtom` (deleted: which surface
 * the Quests page showed, now `project.defaultSurface` plus two real
 * routes). The two were independent — the log is a fixture of the `project`
 * layout and stands beside the list and the quest detail alike — and
 * folding them together would have made a board/list switch look like it
 * could move the pane. That reasoning is why this atom survived the other
 * one's retirement rather than going with it.
 *
 * `persist: "cookie"`, not `"localStorage"`: `ProjectView` decides this
 * layout during SSR, on first paint, and web storage does not exist there. A
 * localStorage-backed atom reads empty on the server, so someone who had
 * collapsed the pane would get one frame of the full pane before it snapped
 * shut, and every server boot would log the "persistence unavailable in this
 * environment" warning. The value is a two-state UI preference and never
 * trust-bearing, so a cookie costs nothing.
 *
 * Global rather than per-project: this is a statement about how the person
 * wants to work, not about one project. (The opposite call from
 * `defaultSurface`, which IS per-project — a team's landing surface is a
 * property of the team's work, a collapsed pane is a property of the
 * reader.)
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const questLogCollapsedAtom = $atom({
  name: "lor.quests.log-collapsed",
  schema: z.object({
    collapsed: z.boolean(),
  }),
  default: { collapsed: false },
  persist: "cookie",
});
