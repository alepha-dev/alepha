import { $atom, z } from "alepha";

/**
 * Whether the Quest Log pane is collapsed to its rail.
 *
 * Separate from `questsViewAtom` rather than a third field on it: that atom
 * answers "which surface does the Quests page show", and the two are
 * independent — the log is a fixture of the `project` layout and stands beside
 * the list and the quest detail alike, while the view is a property of one
 * page. Folding them together would make a board/list switch look like it
 * could move the pane.
 *
 * `persist: "cookie"`, not `"localStorage"`, for exactly the reason
 * `questsViewAtom` documents at length: `ProjectView` decides this layout
 * during SSR, on first paint, and web storage does not exist there. A
 * localStorage-backed atom reads empty on the server, so someone who had
 * collapsed the pane would get one frame of the full pane before it snapped
 * shut, and every server boot would log the "persistence unavailable in this
 * environment" warning. The value is a two-state UI preference and never
 * trust-bearing, so a cookie costs nothing.
 *
 * Global rather than per-project, matching `questsViewAtom`: this is a
 * statement about how the person wants to work, not about one project.
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
