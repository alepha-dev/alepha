import { $atom, z } from "alepha";

/**
 * Whether a folio tree refresh is in flight (#Q3120).
 *
 * ⚠️ An atom rather than a prop, because the menus that read it render inside
 * `TreeView`'s memoised rows. A row's context menu content is built when the
 * ROW renders, and a refresh does not re-render the rows, so a `refreshing`
 * prop handed down through `renderMenu` would freeze at whatever it was the
 * last time the row drew: the Refresh item would stay enabled during the very
 * refresh it should wait for. `FolioTreeRefreshMenuItem` subscribes to this
 * atom itself, which re-renders the item alone, inside the open menu.
 *
 * `useFolioTreeModel`'s refresh action is its only writer. The header's
 * button keeps reading the action's own `loading`, since `FolioTree` itself
 * re-renders when that moves.
 */
export const folioTreeRefreshingAtom = $atom({
  name: "lor.folio.tree.refreshing",
  schema: z.object({
    refreshing: z.boolean(),
  }),
  default: { refreshing: false },
});
